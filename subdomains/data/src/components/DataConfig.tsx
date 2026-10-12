import { useEffect, useMemo, useState } from 'react'
import {
  detectedRunConfig,
  loadRunConfig,
  nominalFuelDensity,
  resetRunConfig,
  saveRunConfig,
  type RunConfig,
  type VenturiConfig,
} from '../lib/dataConfig'
import { useTelemetry } from '../store'
import type { Channel, TelemetryFile } from '../types'

function channelLabel(channel: Channel) {
  if (!channel.unit || channel.name.toLowerCase().includes(`(${channel.unit.toLowerCase()})`)) return channel.name
  return `${channel.name} (${channel.unit})`
}

function PressureSelect({ label, file, value, onChange }: {
  label: string
  file: TelemetryFile
  value: string
  onChange: (value: string) => void
}) {
  const channels = file.channels.filter((channel) => /^(psi|psia|psig|pa|kpa|mpa|bar)$/i.test(channel.unit.trim()))
  return <label className="cea-field">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Not mapped</option>
      {channels.map((channel) => <option key={channel.key} value={channel.key}>{channelLabel(channel)}</option>)}
    </select>
  </label>
}

function StateSelect({ label, file, value, onChange }: {
  label: string
  file: TelemetryFile
  value: string
  onChange: (value: string) => void
}) {
  const channels = file.channels.filter((channel) => /^(state|flag|bool|boolean)$/i.test(channel.unit.trim()))
  return <label className="cea-field">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Not mapped</option>
      {channels.map((channel) => <option key={channel.key} value={channel.key}>{channelLabel(channel)}</option>)}
    </select>
  </label>
}

function VenturiFields({ title, file, value, onChange, densityHint }: {
  title: string
  file: TelemetryFile
  value: VenturiConfig
  onChange: (value: VenturiConfig) => void
  densityHint: string
}) {
  return <details className="cea-details" open>
    <summary>{title} venturi</summary>
    <PressureSelect label="Inlet pressure" file={file} value={value.inletPressureKey}
      onChange={(inletPressureKey) => onChange({ ...value, inletPressureKey })} />
    <PressureSelect label="Throat pressure" file={file} value={value.throatPressureKey}
      onChange={(throatPressureKey) => onChange({ ...value, throatPressureKey })} />
    <div className="cea-fixed-grid">
      <label className="cea-field">CdA (m²)
        <input type="number" min="0" step="any" value={value.cdaM2}
          onChange={(event) => onChange({ ...value, cdaM2: event.target.value })} />
      </label>
      <label className="cea-field">Density (kg/m³)
        <input type="number" min="0" step="any" placeholder={densityHint} value={value.densityKgM3}
          onChange={(event) => onChange({ ...value, densityKgM3: event.target.value })} />
      </label>
    </div>
  </details>
}

export function DataConfig({ onAnalyze }: { onAnalyze: () => void }) {
  const { files } = useTelemetry()
  const sourceFiles = useMemo(() => files.filter((file) => !file.id.startsWith('analysis:')), [files])
  const [sourceId, setSourceId] = useState('')
  const source = sourceFiles.find((file) => file.id === sourceId) || sourceFiles[0] || null
  const [config, setConfig] = useState<RunConfig | null>(null)

  useEffect(() => {
    if (!source) {
      setConfig(null)
      return
    }
    if (source.id !== sourceId) setSourceId(source.id)
    setConfig(loadRunConfig(source))
  }, [source?.id])

  if (!source || !config) return <section><div className="kicker">Per-run setup</div><h2>Data config</h2><p className="hint">Load a CSV to configure its sensors and geometry.</p></section>

  const commit = (next: RunConfig) => {
    setConfig(next)
    saveRunConfig(source, next)
  }
  const update = <K extends keyof RunConfig>(key: K, value: RunConfig[K]) => commit({ ...config, [key]: value })
  const throatArea = Number(config.throatAreaIn2)
  const throatDiameter = config.throatAreaIn2.trim() && Number.isFinite(throatArea) && throatArea > 0
    ? String(Number(Math.sqrt(4 * throatArea / Math.PI).toPrecision(8)))
    : ''

  const autoMap = () => {
    const detected = detectedRunConfig(source)
    commit({
      ...config,
      chamberPressureKey: detected.chamberPressureKey,
      thrustKey: detected.thrustKey,
      oxidizerRunlineKey: detected.oxidizerRunlineKey,
      fuelRunlineKey: detected.fuelRunlineKey,
      oxidizer: {
        ...config.oxidizer,
        inletPressureKey: detected.oxidizer.inletPressureKey,
        throatPressureKey: detected.oxidizer.throatPressureKey,
      },
      fuel: {
        ...config.fuel,
        inletPressureKey: detected.fuel.inletPressureKey,
        throatPressureKey: detected.fuel.throatPressureKey,
      },
    })
  }

  return <section className="cea-panel tab-panel">
    <div className="side-head">
      <div><div className="kicker">Per-run setup</div><h2>Data config</h2></div>
      <span className="saved-state">Auto-saved</span>
    </div>
    <p className="hint">Mappings and calibration are stored in this browser for this CSV. CdA defaults to the Draco source-of-truth value.</p>
    <label className="cea-field">Run
      <select value={source.id} onChange={(event) => setSourceId(event.target.value)}>
        {sourceFiles.map((file) => <option key={file.id} value={file.id}>{file.name.replace(/\.csv$/i, '')}</option>)}
      </select>
    </label>

    <details className="cea-details" open>
      <summary>Engine telemetry</summary>
      <PressureSelect label="Chamber pressure" file={source} value={config.chamberPressureKey}
        onChange={(value) => update('chamberPressureKey', value)} />
      <label className="cea-field">Thrust
        <select value={config.thrustKey} onChange={(event) => update('thrustKey', event.target.value)}>
          <option value="">Not mapped</option>
          {source.channels.filter((channel) => /^(lbf|lb-f|n|kn)$/i.test(channel.unit.trim())).map((channel) =>
            <option key={channel.key} value={channel.key}>{channelLabel(channel)}</option>)}
        </select>
      </label>
      <StateSelect label="Oxidizer runline" file={source} value={config.oxidizerRunlineKey}
        onChange={(value) => update('oxidizerRunlineKey', value)} />
      <StateSelect label="Fuel runline" file={source} value={config.fuelRunlineKey}
        onChange={(value) => update('fuelRunlineKey', value)} />
    </details>

    <details className="cea-details">
      <summary>Thrust calibration</summary>
      <p className="field-help">Auto tare uses the pre-fire samples. Auto polarity makes the firing deflection positive. Use scale when the CSV channel is mislabeled or still in acquisition counts.</p>
      <label className="cea-field">Polarity
        <select value={config.thrustPolarity}
          onChange={(event) => update('thrustPolarity', event.target.value as RunConfig['thrustPolarity'])}>
          <option value="auto">Auto from firing deflection</option>
          <option value="positive">Positive is thrust</option>
          <option value="negative">Negative is thrust</option>
        </select>
      </label>
      <label className="cea-field">Tare
        <select value={config.thrustTareMode}
          onChange={(event) => update('thrustTareMode', event.target.value as RunConfig['thrustTareMode'])}>
          <option value="auto">Auto from pre-fire baseline</option>
          <option value="none">No tare</option>
          <option value="manual">Manual tare</option>
        </select>
      </label>
      <div className="cea-fixed-grid">
        <label className="cea-field">Scale multiplier
          <input type="number" step="any" value={config.thrustScale}
            onChange={(event) => update('thrustScale', event.target.value)} />
        </label>
        {config.thrustTareMode === 'manual' && <label className="cea-field">Manual tare (lbf)
          <input type="number" step="any" value={config.thrustTareLbf}
            onChange={(event) => update('thrustTareLbf', event.target.value)} />
        </label>}
      </div>
    </details>

    <details className="cea-details" open>
      <summary>Propellants</summary>
      <label className="cea-field">Fuel
        <select value={config.fuelType} onChange={(event) => {
          const fuelType = event.target.value as RunConfig['fuelType']
          commit({ ...config, fuelType, fuel: { ...config.fuel, densityKgM3: nominalFuelDensity(fuelType) } })
        }}>
          <option value="ipa">Isopropyl alcohol (IPA)</option>
          <option value="ethanol">Ethanol</option>
          <option value="custom">Custom density</option>
        </select>
      </label>
      <p className="field-help">Nominal liquid density is filled at approximately 20 °C and remains editable below for measured propellant temperature or concentration.</p>
    </details>

    <details className="cea-details" open>
      <summary>NASA CEA conditions</summary>
      <p className="field-help">Blank Pc and O/F fields use the averages backed out from the selected firing window. CEA evaluates the average operating point.</p>
      <label className="cea-field">Chemistry model
        <select value={config.ceaMode}
          onChange={(event) => update('ceaMode', event.target.value as RunConfig['ceaMode'])}>
          <option value="equilibrium">Equilibrium expansion</option>
          <option value="frozen">Frozen from throat</option>
        </select>
      </label>
      <div className="cea-fixed-grid">
        <label className="cea-field">Pc override (psi)
          <input type="number" min="0" step="any" placeholder="Measured average" value={config.ceaChamberPressurePsi}
            onChange={(event) => update('ceaChamberPressurePsi', event.target.value)} />
        </label>
        <label className="cea-field">O/F override
          <input type="number" min="0" step="any" placeholder="Measured average" value={config.ceaOfRatio}
            onChange={(event) => update('ceaOfRatio', event.target.value)} />
        </label>
        <label className="cea-field">Nozzle Ae/At
          <input type="number" min="1" step="any" value={config.ceaExpansionRatio}
            onChange={(event) => update('ceaExpansionRatio', event.target.value)} />
        </label>
        <label className="cea-field">Ambient (psia)
          <input type="number" min="0" step="any" value={config.ceaAmbientPressurePsi}
            onChange={(event) => update('ceaAmbientPressurePsi', event.target.value)} />
        </label>
        <label className="cea-field">Fuel inlet (K)
          <input type="number" min="0" step="any" value={config.fuelTemperatureK}
            onChange={(event) => update('fuelTemperatureK', event.target.value)} />
        </label>
        <label className="cea-field">LOX inlet (K)
          <input type="number" min="0" step="any" value={config.oxidizerTemperatureK}
            onChange={(event) => update('oxidizerTemperatureK', event.target.value)} />
        </label>
      </div>
      <p className="field-help">Ethanol uses CEA's liquid species. IPA uses a custom liquid C₃H₈O reactant based on NIST formation enthalpy and liquid heat capacity.</p>
    </details>

    <VenturiFields title="Oxidizer" file={source} value={config.oxidizer} densityHint="e.g. LOX 1141"
      onChange={(value) => update('oxidizer', value)} />
    <VenturiFields title="Fuel" file={source} value={config.fuel} densityHint="Fuel selection fills this"
      onChange={(value) => update('fuel', value)} />

    <details className="cea-details" open>
      <summary>Engine solve basis</summary>
      <p className="field-help">Throat area, Cf, and c* cannot all be recovered independently from Pc, thrust, and mass flow. Supply one basis; the other two are calculated.</p>
      <label className="cea-field">Known quantity
        <select value={config.solveBasis} onChange={(event) => update('solveBasis', event.target.value as RunConfig['solveBasis'])}>
          <option value="throat-area">Throat area → solve Cf and c*</option>
          <option value="cf">Reference Cf → solve throat and c*</option>
          <option value="cstar">Reference c* → solve throat and Cf</option>
        </select>
      </label>
      {config.solveBasis === 'throat-area' && <div className="cea-fixed-grid">
        <label className="cea-field">Throat diameter (in)
          <input type="number" min="0" step="any" placeholder="Either geometry input" value={throatDiameter}
            onChange={(event) => {
              const diameter = Number(event.target.value)
              update('throatAreaIn2', event.target.value.trim() && Number.isFinite(diameter) && diameter > 0
                ? String(Math.PI * diameter ** 2 / 4) : '')
            }} />
        </label>
        <label className="cea-field">Throat area (in²)
          <input type="number" min="0" step="any" placeholder="Either geometry input" value={config.throatAreaIn2}
            onChange={(event) => update('throatAreaIn2', event.target.value)} />
        </label>
      </div>}
      {config.solveBasis === 'cf' && <label className="cea-field">Reference Cf
        <input type="number" min="0" step="any" placeholder="CEA or design value" value={config.referenceCf}
          onChange={(event) => update('referenceCf', event.target.value)} />
      </label>}
      {config.solveBasis === 'cstar' && <label className="cea-field">Reference c* (ft/s)
        <input type="number" min="0" step="any" placeholder="CEA or design value" value={config.referenceCstarFtS}
          onChange={(event) => update('referenceCstarFtS', event.target.value)} />
      </label>}
    </details>

    <div className="config-actions">
      <button className="btn" type="button" onClick={autoMap}>Auto-map</button>
      <button className="btn" type="button" onClick={() => setConfig(resetRunConfig(source))}>Reset</button>
      <button className="btn accent" type="button" onClick={onAnalyze}>Analyze</button>
    </div>
  </section>
}
