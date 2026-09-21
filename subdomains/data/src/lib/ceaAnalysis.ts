import type { Channel, TelemetryFile } from '../types'

const PSI_TO_PA = 6894.757293168
const LBF_TO_N = 4.4482216152605
const LBM_TO_KG = 0.45359237
const FT_TO_M = 0.3048
const IN_TO_M = 0.0254
const G0 = 9.80665

export type AnalysisChannel = Channel | null

export type CeaQuickInputs = {
  file: TelemetryFile
  pressure: AnalysisChannel
  thrust: AnalysisChannel
  totalFlow: AnalysisChannel
  oxidizerFlow: AnalysisChannel
  fuelFlow: AnalysisChannel
  start: number
  end: number | null
  throatDiameterIn: number | null
  fixedCf: number | null
  idealCstarFtS: number | null
}

export type DerivedMetric = {
  id: string
  name: string
  unit: string
  average: number
  values: Float64Array
}

export type QuickAnalysis = {
  samples: number
  t0: number
  t1: number
  averages: { label: string; value: number; unit: string }[]
  metrics: DerivedMetric[]
  warnings: string[]
}

function normalizedUnit(unit: string) {
  return unit.toLowerCase().replace(/\s+/g, '').replace(/sec/g, 's')
}

function pressurePa(value: number, unit: string) {
  const u = normalizedUnit(unit)
  if (u === 'psi' || u === 'psia' || u === 'psig') return value * PSI_TO_PA
  if (u === 'pa') return value
  if (u === 'kpa') return value * 1000
  if (u === 'mpa') return value * 1e6
  if (u === 'bar') return value * 1e5
  return NaN
}

function forceN(value: number, unit: string) {
  const u = normalizedUnit(unit)
  if (u === 'lbf' || u === 'lb-f') return value * LBF_TO_N
  if (u === 'n') return value
  if (u === 'kn') return value * 1000
  return NaN
}

function massFlowKgS(value: number, unit: string) {
  const u = normalizedUnit(unit)
  if (u === 'kg/s' || u === 'kgps') return value
  if (u === 'g/s' || u === 'gps') return value / 1000
  if (u === 'lbm/s' || u === 'lb/s' || u === 'lbps') return value * LBM_TO_KG
  return NaN
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

function converted(channel: AnalysisChannel, convert: (value: number, unit: string) => number, length: number) {
  const values = new Float64Array(length)
  values.fill(NaN)
  if (!channel) return values
  for (let i = 0; i < Math.min(length, channel.values.length); i++) {
    values[i] = convert(channel.values[i], channel.unit)
  }
  return values
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
}

export function runQuickAnalysis(inputs: CeaQuickInputs): QuickAnalysis {
  const { file } = inputs
  const included = new Uint8Array(file.rowCount)
  let samples = 0
  let t1 = -Infinity
  for (let i = 0; i < file.rowCount; i++) {
    const t = file.tElapsed[i]
    if (!Number.isFinite(t) || t < inputs.start || (inputs.end !== null && t > inputs.end)) continue
    included[i] = 1
    samples += 1
    t1 = t
  }
  if (!samples) throw new Error('No samples fall inside the selected time window.')

  const pc = converted(inputs.pressure, pressurePa, file.rowCount)
  const thrust = converted(inputs.thrust, forceN, file.rowCount)
  const totalFlow = converted(inputs.totalFlow, massFlowKgS, file.rowCount)
  const oxidizerFlow = converted(inputs.oxidizerFlow, massFlowKgS, file.rowCount)
  const fuelFlow = converted(inputs.fuelFlow, massFlowKgS, file.rowCount)
  const diameterM = inputs.throatDiameterIn && inputs.throatDiameterIn > 0
    ? inputs.throatDiameterIn * IN_TO_M
    : NaN
  const throatArea = Number.isFinite(diameterM) ? Math.PI * diameterM ** 2 / 4 : NaN
  const idealCstar = inputs.idealCstarFtS && inputs.idealCstarFtS > 0
    ? inputs.idealCstarFtS * FT_TO_M
    : NaN
  const fixedCf = inputs.fixedCf && inputs.fixedCf > 0 ? inputs.fixedCf : NaN
  const metrics: DerivedMetric[] = []

  if (inputs.pressure && inputs.thrust && Number.isFinite(throatArea)) {
    addMetric(metrics, included, 'cf-measured', 'Measured Cf', '', (i) => thrust[i] / (pc[i] * throatArea))
  }
  if (inputs.pressure && inputs.thrust && Number.isFinite(fixedCf)) {
    addMetric(metrics, included, 'throat-effective', 'Effective throat diameter', 'in', (i) =>
      Math.sqrt((4 * thrust[i]) / (Math.PI * fixedCf * pc[i])) / IN_TO_M)
  }
  if (inputs.pressure && Number.isFinite(throatArea) && Number.isFinite(fixedCf)) {
    addMetric(metrics, included, 'thrust-predicted', 'Predicted thrust', 'lbf', (i) =>
      fixedCf * pc[i] * throatArea / LBF_TO_N)
  }
  if (inputs.pressure && Number.isFinite(throatArea) && Number.isFinite(idealCstar)) {
    addMetric(metrics, included, 'mass-flow-estimated', 'Estimated total mass flow', 'lbm/s', (i) =>
      pc[i] * throatArea / idealCstar / LBM_TO_KG)
  }
  if (inputs.pressure && inputs.totalFlow && Number.isFinite(throatArea)) {
    addMetric(metrics, included, 'cstar-measured', 'Measured c*', 'ft/s', (i) =>
      pc[i] * throatArea / totalFlow[i] / FT_TO_M)
  }
  if (inputs.pressure && inputs.totalFlow && Number.isFinite(throatArea) && Number.isFinite(idealCstar)) {
    addMetric(metrics, included, 'cstar-efficiency', 'c* efficiency', '%', (i) =>
      100 * pc[i] * throatArea / totalFlow[i] / idealCstar)
  }
  if (inputs.thrust && inputs.totalFlow) {
    addMetric(metrics, included, 'isp-measured', 'Measured specific impulse', 's', (i) =>
      thrust[i] / (totalFlow[i] * G0))
  }
  if (inputs.oxidizerFlow && inputs.fuelFlow) {
    addMetric(metrics, included, 'of-ratio', 'O/F ratio', '', (i) => oxidizerFlow[i] / fuelFlow[i])
  }

  const averages: QuickAnalysis['averages'] = []
  const avgPc = finiteAverage(pc, included)
  const avgThrust = finiteAverage(thrust, included)
  const avgFlow = finiteAverage(totalFlow, included)
  if (Number.isFinite(avgPc)) averages.push({ label: 'Chamber pressure', value: avgPc / PSI_TO_PA, unit: 'psi' })
  if (Number.isFinite(avgThrust)) averages.push({ label: 'Measured thrust', value: avgThrust / LBF_TO_N, unit: 'lbf' })
  if (Number.isFinite(avgFlow)) averages.push({ label: 'Total mass flow', value: avgFlow / LBM_TO_KG, unit: 'lbm/s' })

  const warnings: string[] = []
  if (!inputs.pressure) warnings.push('Map a chamber-pressure channel to calculate performance.')
  else if (!Number.isFinite(avgPc)) warnings.push(`Pressure unit “${inputs.pressure.unit || 'blank'}” is not supported.`)
  if (inputs.thrust && !Number.isFinite(avgThrust)) warnings.push(`Thrust unit “${inputs.thrust.unit || 'blank'}” is not supported.`)
  if (inputs.totalFlow && !Number.isFinite(avgFlow)) warnings.push(`Mass-flow unit “${inputs.totalFlow.unit || 'blank'}” is not supported.`)
  if (!Number.isFinite(throatArea)) warnings.push('Enter throat diameter to calculate Cf and c*.')
  if (!Number.isFinite(fixedCf)) warnings.push('Enter fixed Cf to estimate thrust or effective throat size.')
  if (!Number.isFinite(idealCstar)) warnings.push('Enter ideal c* to estimate mass flow and c* efficiency.')

  return { samples, t0: inputs.start, t1, averages, metrics, warnings }
}

export function bestChannel(file: TelemetryFile, kind: 'pressure' | 'thrust' | 'totalFlow' | 'oxidizerFlow' | 'fuelFlow') {
  const scored = file.channels.map((channel) => {
    const text = `${channel.name} ${channel.unit}`.toLowerCase()
    let score = 0
    if (kind === 'pressure') {
      if (/\b(pt0|pc)\b/.test(text)) score += 9
      if (/chamber/.test(text)) score += 8
      if (/pressure|psi|bar|pa\b/.test(text)) score += 3
      if (/tank|manifold|venturi|bus|purge/.test(text)) score -= 5
    } else if (kind === 'thrust') {
      if (/thrust combined|combined thrust/.test(text)) score += 12
      if (/thrust/.test(text)) score += 7
      if (/combined|total/.test(text)) score += 3
      if (/lbf|\bn\b|kn/.test(text)) score += 2
    } else {
      const flow = /mass.?flow|mdot|ṁ/.test(text)
      if (flow) score += 7
      if (kind === 'totalFlow' && /total|combined/.test(text)) score += 6
      if (kind === 'oxidizerFlow' && /lox|oxidizer|\box\b/.test(text)) score += 6
      if (kind === 'fuelFlow' && /fuel|ethanol|ipa|rp.?1|methane/.test(text)) score += 6
      if (kind !== 'totalFlow' && /total|combined/.test(text)) score -= 3
    }
    return { channel, score }
  }).sort((a, b) => b.score - a.score)
  return scored[0]?.score > 0 ? scored[0].channel.key : ''
}
