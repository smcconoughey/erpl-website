import type { RunConfig, VenturiConfig } from './dataConfig'
import type { Channel, TelemetryFile } from '../types'

const PSI_TO_PA = 6894.757293168
const LBF_TO_N = 4.4482216152605
const LBM_TO_KG = 0.45359237
const FT_TO_M = 0.3048
const IN_TO_M = 0.0254
const IN2_TO_M2 = IN_TO_M ** 2
const G0 = 9.80665

export type DerivedMetric = {
  id: string
  name: string
  unit: string
  average: number
  values: Float64Array
}

export type EngineAnalysisResult = {
  samples: number
  t0: number
  t1: number
  averages: { label: string; value: number; unit: string }[]
  metrics: DerivedMetric[]
  notes: string[]
  warnings: string[]
}

export type DetectedFiringWindow = {
  start: number
  end: number
  source: string
}

function number(value: string) {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : NaN
}

function finiteNumber(value: string) {
  if (!value.trim()) return NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function normalizedUnit(unit: string) {
  return unit.toLowerCase().replace(/\s+/g, '')
}

function pressurePa(value: number, unit: string) {
  const normalized = normalizedUnit(unit)
  if (normalized === 'psi' || normalized === 'psia' || normalized === 'psig') return value * PSI_TO_PA
  if (normalized === 'pa') return value
  if (normalized === 'kpa') return value * 1000
  if (normalized === 'mpa') return value * 1e6
  if (normalized === 'bar') return value * 1e5
  return NaN
}

function forceN(value: number, unit: string) {
  const normalized = normalizedUnit(unit)
  if (normalized === 'lbf' || normalized === 'lb-f') return value * LBF_TO_N
  if (normalized === 'n') return value
  if (normalized === 'kn') return value * 1000
  return NaN
}

function converted(channel: Channel | null, convert: (value: number, unit: string) => number, length: number) {
  const values = new Float64Array(length)
  values.fill(NaN)
  if (!channel) return values
  for (let i = 0; i < Math.min(length, channel.values.length); i++) values[i] = convert(channel.values[i], channel.unit)
  return values
}

function finiteAverage(values: Float64Array, included: Uint8Array) {
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    if (!included[i] || !Number.isFinite(values[i])) continue
    sum += values[i]
    count += 1
  }
  return count ? sum / count : NaN
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return NaN
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function quantile(values: number[], fraction: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return NaN
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))]
}

function longestWindow(file: TelemetryFile, active: (index: number) => boolean) {
  let bestStart = -1
  let bestEnd = -1
  let currentStart = -1
  for (let i = 0; i <= file.rowCount; i++) {
    if (i < file.rowCount && active(i)) {
      if (currentStart < 0) currentStart = i
      continue
    }
    if (currentStart >= 0 && i - currentStart > bestEnd - bestStart) {
      bestStart = currentStart
      bestEnd = i - 1
    }
    currentStart = -1
  }
  return bestStart >= 0 && bestEnd > bestStart ? { start: bestStart, end: bestEnd } : null
}

function addMetric(metrics: DerivedMetric[], included: Uint8Array, id: string, name: string, unit: string,
  calculate: (index: number) => number) {
  const values = new Float64Array(included.length)
  values.fill(NaN)
  for (let i = 0; i < included.length; i++) {
    if (!included[i]) continue
    const value = calculate(i)
    if (Number.isFinite(value)) values[i] = value
  }
  const average = finiteAverage(values, included)
  if (Number.isFinite(average)) metrics.push({ id, name, unit, average, values })
  return values
}

function venturiFlow(file: TelemetryFile, config: VenturiConfig, label: string, warnings: string[]) {
  const inlet = file.channels.find((channel) => channel.key === config.inletPressureKey) || null
  const throat = file.channels.find((channel) => channel.key === config.throatPressureKey) || null
  const cda = number(config.cdaM2)
  const density = number(config.densityKgM3)
  const values = new Float64Array(file.rowCount)
  values.fill(NaN)
  if (!inlet || !throat || !Number.isFinite(cda) || !Number.isFinite(density)) {
    const missing = [
      !inlet || !throat ? 'pressure pair' : '',
      !Number.isFinite(cda) ? 'CdA' : '',
      !Number.isFinite(density) ? 'density' : '',
    ].filter(Boolean).join(', ')
    warnings.push(`${label} mass flow needs ${missing} in Config.`)
    return values
  }
  for (let i = 0; i < file.rowCount; i++) {
    const deltaP = pressurePa(inlet.values[i], inlet.unit) - pressurePa(throat.values[i], throat.unit)
    if (!Number.isFinite(deltaP)) continue
    // Reverse ΔP is no forward flow. Keep the sample at 0 so a wider firing window
    // still spans the selected bounds instead of dropping those points.
    values[i] = cda * Math.sqrt(2 * density * Math.max(0, deltaP))
  }
  return values
}

export function detectedFiringWindow(file: TelemetryFile, config: RunConfig): DetectedFiringWindow | null {
  const oxidizerRunline = file.channels.find((channel) => channel.key === config.oxidizerRunlineKey) || null
  const fuelRunline = file.channels.find((channel) => channel.key === config.fuelRunlineKey) || null
  if (oxidizerRunline || fuelRunline) {
    const window = longestWindow(file, (index) => {
      const oxidizerOpen = !oxidizerRunline || oxidizerRunline.values[index] > 0.5
      const fuelOpen = !fuelRunline || fuelRunline.values[index] > 0.5
      return oxidizerOpen && fuelOpen
    })
    if (window) return {
      start: file.tElapsed[window.start],
      end: file.tElapsed[window.end],
      source: oxidizerRunline && fuelRunline ? 'oxidizer + fuel runlines' : 'runline state',
    }
  }

  const pressure = file.channels.find((channel) => channel.key === config.chamberPressureKey) || null
  if (!pressure) return null
  const finite = Array.from(pressure.values).filter(Number.isFinite)
  const baseline = quantile(finite, 0.1)
  const peak = quantile(finite, 0.995)
  const span = peak - baseline
  if (!Number.isFinite(span) || span <= Math.max(1e-9, Math.abs(baseline) * 0.02)) return null
  const threshold = baseline + span * 0.15
  const window = longestWindow(file, (index) => Number.isFinite(pressure.values[index]) && pressure.values[index] >= threshold)
  return window ? {
    start: file.tElapsed[window.start],
    end: file.tElapsed[window.end],
    source: 'chamber pressure',
  } : null
}

function correctedThrust(file: TelemetryFile, channel: Channel | null, config: RunConfig,
  included: Uint8Array, tareBoundary: number, warnings: string[], notes: string[]) {
  const raw = converted(channel, forceN, file.rowCount)
  const corrected = new Float64Array(file.rowCount)
  corrected.fill(NaN)
  if (!channel) return corrected

  let tare = 0
  if (config.thrustTareMode === 'manual') {
    const manual = finiteNumber(config.thrustTareLbf)
    if (!Number.isFinite(manual)) warnings.push('Manual thrust tare is blank or invalid in Config.')
    else tare = manual * LBF_TO_N
  } else if (config.thrustTareMode === 'auto') {
    let baseline: number[] = []
    for (let i = 0; i < file.rowCount; i++) {
      if (file.tElapsed[i] < tareBoundary && file.tElapsed[i] >= tareBoundary - 5 && Number.isFinite(raw[i])) baseline.push(raw[i])
    }
    if (!baseline.length) {
      for (let i = 0; i < file.rowCount; i++) {
        if (file.tElapsed[i] < tareBoundary && Number.isFinite(raw[i])) baseline.push(raw[i])
      }
    }
    const detected = median(baseline)
    if (Number.isFinite(detected)) tare = detected
    else warnings.push('Auto thrust tare needs pre-fire samples; select manual or no tare in Config.')
  }

  const scale = finiteNumber(config.thrustScale)
  if (!Number.isFinite(scale) || scale === 0) {
    warnings.push('Thrust scale multiplier must be a non-zero number in Config.')
    return corrected
  }
  let sign = config.thrustPolarity === 'negative' ? -1 : 1
  if (config.thrustPolarity === 'auto') {
    const firingValues: number[] = []
    for (let i = 0; i < file.rowCount; i++) {
      if (included[i] && Number.isFinite(raw[i])) firingValues.push(raw[i] - tare)
    }
    if (median(firingValues) < 0) sign = -1
  }
  for (let i = 0; i < file.rowCount; i++) {
    if (Number.isFinite(raw[i])) corrected[i] = (raw[i] - tare) * sign * scale
  }
  notes.push(`Thrust correction: tare ${Number(tare / LBF_TO_N).toFixed(2)} lbf · ${sign < 0 ? 'inverted' : 'positive'} · ×${scale}`)
  return corrected
}

export function runEngineAnalysis(file: TelemetryFile, config: RunConfig, start: number, end: number | null): EngineAnalysisResult {
  const included = new Uint8Array(file.rowCount)
  let samples = 0
  let first = Infinity
  let last = -Infinity
  for (let i = 0; i < file.rowCount; i++) {
    const time = file.tElapsed[i]
    if (!Number.isFinite(time) || time < start || (end !== null && time > end)) continue
    included[i] = 1
    samples += 1
    first = Math.min(first, time)
    last = Math.max(last, time)
  }
  if (!samples) throw new Error('No samples fall inside the selected time window.')

  const warnings: string[] = []
  const pressureChannel = file.channels.find((channel) => channel.key === config.chamberPressureKey) || null
  const thrustChannel = file.channels.find((channel) => channel.key === config.thrustKey) || null
  const pc = converted(pressureChannel, pressurePa, file.rowCount)
  const notes: string[] = []
  const thrust = correctedThrust(file, thrustChannel, config, included, start, warnings, notes)
  const oxidizer = venturiFlow(file, config.oxidizer, 'Oxidizer', warnings)
  const fuel = venturiFlow(file, config.fuel, 'Fuel', warnings)
  const total = new Float64Array(file.rowCount)
  total.fill(NaN)
  for (let i = 0; i < file.rowCount; i++) {
    if (Number.isFinite(oxidizer[i]) && Number.isFinite(fuel[i])) total[i] = oxidizer[i] + fuel[i]
  }

  const metrics: DerivedMetric[] = []
  if (thrustChannel) addMetric(metrics, included, 'thrust-corrected', 'Corrected thrust', 'lbf', (i) => thrust[i] / LBF_TO_N)
  const oxLb = addMetric(metrics, included, 'oxidizer-mdot', 'Oxidizer mass flow', 'lbm/s', (i) => oxidizer[i] / LBM_TO_KG)
  const fuelLb = addMetric(metrics, included, 'fuel-mdot', 'Fuel mass flow', 'lbm/s', (i) => fuel[i] / LBM_TO_KG)
  const totalLb = addMetric(metrics, included, 'total-mdot', 'Total mass flow', 'lbm/s', (i) => total[i] / LBM_TO_KG)
  addMetric(metrics, included, 'of-ratio', 'O/F ratio', '', (i) => oxidizer[i] / fuel[i])
  if (thrustChannel && Number.isFinite(finiteAverage(total, included))) {
    addMetric(metrics, included, 'specific-impulse', 'Measured specific impulse', 's', (i) =>
      thrust[i] > 0 && total[i] > 0 ? thrust[i] / (total[i] * G0) : NaN)
  }

  const throatArea = number(config.throatAreaIn2) * IN2_TO_M2
  const referenceCf = number(config.referenceCf)
  const referenceCstar = number(config.referenceCstarFtS) * FT_TO_M
  if (!pressureChannel) warnings.push('Map chamber pressure in Config.')
  if (!thrustChannel) warnings.push('Map thrust in Config to calculate Cf and specific impulse.')

  if (config.solveBasis === 'throat-area') {
    if (!Number.isFinite(throatArea)) warnings.push('Enter engine throat area in Config to solve Cf and c*.')
    if (pressureChannel && thrustChannel && Number.isFinite(throatArea)) {
      addMetric(metrics, included, 'cf', 'Measured Cf', '', (i) =>
        thrust[i] > 0 && pc[i] > 0 ? thrust[i] / (pc[i] * throatArea) : NaN)
    }
    if (pressureChannel && Number.isFinite(throatArea) && Number.isFinite(finiteAverage(total, included))) {
      addMetric(metrics, included, 'cstar', 'Measured c*', 'ft/s', (i) => pc[i] * throatArea / total[i] / FT_TO_M)
    }
  } else if (config.solveBasis === 'cf') {
    if (!Number.isFinite(referenceCf)) warnings.push('Enter reference Cf in Config to back out throat size and c*.')
    if (pressureChannel && thrustChannel && Number.isFinite(referenceCf)) {
      const area = addMetric(metrics, included, 'throat-area-effective', 'Effective throat area', 'in²',
        (i) => thrust[i] > 0 && pc[i] > 0 ? thrust[i] / (referenceCf * pc[i]) / IN2_TO_M2 : NaN)
      addMetric(metrics, included, 'throat-diameter-effective', 'Effective throat diameter', 'in',
        (i) => Math.sqrt(4 * area[i] * IN2_TO_M2 / Math.PI) / IN_TO_M)
      if (Number.isFinite(finiteAverage(total, included))) {
        addMetric(metrics, included, 'cstar', 'Measured c*', 'ft/s',
          (i) => pc[i] * area[i] * IN2_TO_M2 / total[i] / FT_TO_M)
      }
    }
  } else {
    if (!Number.isFinite(referenceCstar)) warnings.push('Enter reference c* in Config to back out throat size and Cf.')
    if (pressureChannel && Number.isFinite(referenceCstar) && Number.isFinite(finiteAverage(total, included))) {
      const area = addMetric(metrics, included, 'throat-area-effective', 'Effective throat area', 'in²',
        (i) => referenceCstar * total[i] / pc[i] / IN2_TO_M2)
      addMetric(metrics, included, 'throat-diameter-effective', 'Effective throat diameter', 'in',
        (i) => Math.sqrt(4 * area[i] * IN2_TO_M2 / Math.PI) / IN_TO_M)
      if (thrustChannel) {
        addMetric(metrics, included, 'cf', 'Measured Cf', '',
          (i) => thrust[i] > 0 && pc[i] > 0 && area[i] > 0
            ? thrust[i] / (pc[i] * area[i] * IN2_TO_M2) : NaN)
      }
    }
  }

  const averages: EngineAnalysisResult['averages'] = []
  const avgPc = finiteAverage(pc, included)
  const avgThrust = finiteAverage(thrust, included)
  const avgOx = finiteAverage(oxLb, included)
  const avgFuel = finiteAverage(fuelLb, included)
  const avgTotal = finiteAverage(totalLb, included)
  if (Number.isFinite(avgPc)) averages.push({ label: 'Chamber pressure', value: avgPc / PSI_TO_PA, unit: 'psi' })
  if (Number.isFinite(avgThrust)) averages.push({ label: 'Corrected thrust', value: avgThrust / LBF_TO_N, unit: 'lbf' })
  if (Number.isFinite(avgOx)) averages.push({ label: 'Oxidizer flow', value: avgOx, unit: 'lbm/s' })
  if (Number.isFinite(avgFuel)) averages.push({ label: 'Fuel flow', value: avgFuel, unit: 'lbm/s' })
  if (Number.isFinite(avgTotal)) averages.push({ label: 'Total flow', value: avgTotal, unit: 'lbm/s' })

  const avgThrustLbf = avgThrust / LBF_TO_N
  if (Number.isFinite(avgThrustLbf) && avgThrustLbf <= 0) warnings.push('Corrected thrust is not positive; check polarity, tare, and the selected channel.')
  if (Number.isFinite(avgThrustLbf) && Math.abs(avgThrustLbf) > 20_000) warnings.push('Corrected thrust exceeds 20,000 lbf; this channel likely needs a calibration scale or contains latched acquisition values.')
  const measuredCf = metrics.find((metric) => metric.id === 'cf')?.average
  if (measuredCf !== undefined && Number.isFinite(measuredCf) && (measuredCf <= 0 || measuredCf > 3)) {
    warnings.push(`Calculated Cf ${measuredCf.toFixed(2)} is outside the expected rocket-nozzle range; check thrust scale, chamber pressure, and throat geometry.`)
  }

  return { samples, t0: first, t1: last, averages, metrics, notes, warnings }
}
