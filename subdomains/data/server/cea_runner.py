#!/usr/bin/env python3
"""Run one authenticated NASA CEA rocket solve from a JSON request on stdin."""

import json
import math
import sys

import numpy as np
import cea


PSI_TO_BAR = 0.06894757293168
G0 = 9.80665
IPA_HF_KJ_MOL = -317.0
IPA_CP_KJ_MOL_K = 0.1612
IPA_MW_G_MOL = 60.09502


def finite(value):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("CEA inputs must be finite numbers.")
    return value


def liquid_ipa(temperature):
    # CEA 3.3.4 has gas-phase 2-propanol but no liquid IPA entry. Use NIST's
    # standard liquid formation enthalpy and a constant-Cp sensible correction.
    enthalpy = IPA_HF_KJ_MOL + IPA_CP_KJ_MOL_K * (temperature - 298.15)
    return cea.Reactant(
        name="IPA(L)",
        formula={"C": 3.0, "H": 8.0, "O": 1.0},
        molecular_weight=IPA_MW_G_MOL,
        enthalpy=enthalpy,
        enthalpy_units="kJ/mol",
        temperature=temperature,
    )


def solve(payload):
    fuel = payload["fuel"]
    fuel_temperature = finite(payload["fuelTemperatureK"])
    oxidizer_temperature = finite(payload["oxidizerTemperatureK"])
    chamber_pressure_bar = finite(payload["chamberPressurePsi"]) * PSI_TO_BAR
    ambient_pressure_bar = finite(payload["ambientPressurePsi"]) * PSI_TO_BAR
    of_ratio = finite(payload["ofRatio"])
    expansion_ratio = finite(payload["expansionRatio"])
    mode = payload["mode"]

    fuel_reactant = liquid_ipa(fuel_temperature) if fuel == "ipa" else "C2H5OH(L)"
    reactants = [fuel_reactant, "O2(L)"]
    reactant_mix = cea.Mixture(reactants)
    product_mix = cea.Mixture(reactants, products_from_reactants=True)
    solver = cea.RocketSolver(product_mix, reactants=reactant_mix)
    solution = cea.RocketSolution(solver)

    fuel_weights = np.array([1.0, 0.0])
    oxidizer_weights = np.array([0.0, 1.0])
    weights = reactant_mix.of_ratio_to_weights(oxidizer_weights, fuel_weights, of_ratio)
    temperatures = np.array([fuel_temperature, oxidizer_temperature])
    chamber_enthalpy = reactant_mix.calc_property(cea.ENTHALPY, weights, temperatures) / cea.R
    solver.solve(
        solution,
        weights,
        chamber_pressure_bar,
        pi_p=chamber_pressure_bar / ambient_pressure_bar,
        supar=[expansion_ratio],
        iac=True,
        n_frz=2 if mode == "frozen" else None,
        hc=chamber_enthalpy,
    )
    if not solution.converged:
        raise RuntimeError(f"NASA CEA did not converge (error {solution.last_error}).")

    exit_index = solution.num_pts - 1
    chamber_species = []
    for name, fractions in solution.mole_fractions.items():
        fraction = float(fractions[0])
        if math.isfinite(fraction) and fraction > 1e-6:
            chamber_species.append({"name": name.strip(), "moleFraction": fraction})
    chamber_species.sort(key=lambda item: item["moleFraction"], reverse=True)

    return {
        "solver": "NASA CEA",
        "version": cea.__version__,
        "converged": True,
        "fuelModel": "NIST liquid IPA custom reactant" if fuel == "ipa" else "CEA C2H5OH(L)",
        "mode": mode,
        "chamberTemperatureK": float(solution.T[0]),
        "chamberGamma": float(solution.gamma_s[0]),
        "chamberMolecularWeight": float(solution.MW[0]),
        "cStarMps": float(solution.c_star[0]),
        "cf": float(solution.coefficient_of_thrust[exit_index]),
        "ispSeconds": float(solution.Isp[exit_index]) / G0,
        "ispVacuumSeconds": float(solution.Isp_vacuum[exit_index]) / G0,
        "exitTemperatureK": float(solution.T[exit_index]),
        "exitPressureBar": float(solution.P[exit_index]),
        "exitMach": float(solution.Mach[exit_index]),
        "exitAreaRatio": float(solution.ae_at[exit_index]),
        "chamberSpecies": chamber_species[:8],
    }


def main():
    cea.set_log_level(cea.LOG_NONE)
    payload = json.load(sys.stdin)
    json.dump({"result": solve(payload)}, sys.stdout, allow_nan=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"error": str(error)}, sys.stdout)
        sys.exit(1)
