import type { Channel, TelemetryFile } from '../types'

const STORAGE_KEY = 'datanator.run-configs.v1'

export type SolveBasis = 'throat-area' | 'cf' | 'cstar'
export type FuelType = 'ipa' | 'ethanol' | 'custom'
export type ThrustPolarity = 'auto' | 'positive' | 'negative'
export type ThrustTareMode = 'auto' | 'none' | 'manual'

export type VenturiConfig = {
  inletPressureKey: string
  throatPressureKey: string
  cdaM2: string
  densityKgM3: string
}

export type RunConfig = {
  chamberPressureKey: string
  thrustKey: string
  oxidizerRunlineKey: string
  fuelRunlineKey: string
  fuelType: FuelType
  thrustPolarity: ThrustPolarity
  thrustTareMode: ThrustTareMode
  thrustTareLbf: string
  thrustScale: string
  solveBasis: SolveBasis
  throatAreaIn2: string
  referenceCf: string
  referenceCstarFtS: string
  oxidizer: VenturiConfig
  fuel: VenturiConfig
}

const EMPTY_VENTURI: VenturiConfig = {
  inletPressureKey: '',
  throatPressureKey: '',
  cdaM2: '3.22e-5',
  densityKgM3: '',
}

export const EMPTY_RUN_CONFIG: RunConfig = {
  chamberPressureKey: '',
  thrustKey: '',
  oxidizerRunlineKey: '',
  fuelRunlineKey: '',
  fuelType: 'ipa',
  thrustPolarity: 'auto',
  thrustTareMode: 'auto',
  thrustTareLbf: '',
  thrustScale: '1',
  solveBasis: 'throat-area',
  throatAreaIn2: '',
  referenceCf: '',
  referenceCstarFtS: '',
  oxidizer: { ...EMPTY_VENTURI },
  fuel: { ...EMPTY_VENTURI },
}

export function nominalFuelDensity(type: FuelType) {
  if (type === 'ipa') return '785'
  if (type === 'ethanol') return '789'
  return ''
}

export function runConfigKey(file: TelemetryFile) {
  return `${file.folder}\u0000${file.name}`
}

function isPressure(channel: Channel) {
  return /^(psi|psia|psig|pa|kpa|mpa|bar)$/i.test(channel.unit.trim())
}

function isForce(channel: Channel) {
  return /^(lbf|lb-f|n|kn)$/i.test(channel.unit.trim())
}

function runline(file: TelemetryFile, propellant: 'oxidizer' | 'fuel') {
  return best(file, (text, channel) => {
    if (!/^(state|flag|bool|boolean)$/i.test(channel.unit.trim())) return -100
    let score = 0
    if (/runline|run line/.test(text)) score += 10
    if (propellant === 'oxidizer' && /lox|oxidizer|\box\b/.test(text)) score += 8
    if (propellant === 'fuel' && /fuel/.test(text)) score += 8
    if (/state|flag/.test(text)) score += 2
    if (/vent|purge|fill/.test(text)) score -= 8
    return score
  }, 16)
}

function best(file: TelemetryFile, score: (text: string, channel: Channel) => number, minimum = 1) {
  const ranked = file.channels
    .map((channel) => ({ channel, score: score(`${channel.name} ${channel.unit}`.toLowerCase(), channel) }))
    .sort((a, b) => b.score - a.score)
  return ranked[0] && ranked[0].score >= minimum ? ranked[0].channel.key : ''
}

function pressureRole(file: TelemetryFile, propellant: 'oxidizer' | 'fuel', role: 'inlet' | 'throat') {
  return best(file, (text, channel) => {
    if (!isPressure(channel)) return -100
    let score = 0
    if (/venturi/.test(text)) score += 8
    if (propellant === 'oxidizer' && /lox|oxidizer|\box\b/.test(text)) score += 7
    if (propellant === 'fuel' && /fuel|ethanol|ipa|rp.?1|methane/.test(text)) score += 7
    if (role === 'inlet' && /inlet|upstream/.test(text)) score += 6
    if (role === 'throat' && /throat/.test(text)) score += 6
    if (role === 'inlet' && /throat/.test(text)) score -= 8
    if (role === 'throat' && /inlet|upstream/.test(text)) score -= 8
    return score
  }, 18)
}

export function detectedRunConfig(file: TelemetryFile): RunConfig {
  const chamberPressureKey = best(file, (text, channel) => {
    if (!isPressure(channel)) return -100
    let score = 0
    if (/\bpt0\b|\bpc\b/.test(text)) score += 10
    if (/chamber/.test(text)) score += 9
    if (/tank|manifold|venturi|bus|purge/.test(text)) score -= 8
    return score
  }, 8)
  const thrustKey = best(file, (text, channel) => {
    if (!isForce(channel)) return -100
    let score = 0
    if (/thrust combined|combined thrust/.test(text)) score += 12
    if (/thrust/.test(text)) score += 8
    if (/combined|total/.test(text)) score += 3
    return score
  }, 8)
  const oxidizerInlet = pressureRole(file, 'oxidizer', 'inlet')
  const oxidizerThroat = pressureRole(file, 'oxidizer', 'throat')
  return {
    ...EMPTY_RUN_CONFIG,
    chamberPressureKey,
    thrustKey,
    oxidizerRunlineKey: runline(file, 'oxidizer'),
    fuelRunlineKey: runline(file, 'fuel'),
    oxidizer: {
      ...EMPTY_VENTURI,
      inletPressureKey: oxidizerInlet,
      throatPressureKey: oxidizerThroat,
      densityKgM3: oxidizerInlet || oxidizerThroat ? '1141' : '',
    },
    fuel: {
      ...EMPTY_VENTURI,
      inletPressureKey: pressureRole(file, 'fuel', 'inlet'),
      throatPressureKey: pressureRole(file, 'fuel', 'throat'),
      densityKgM3: nominalFuelDensity('ipa'),
    },
  }
}

function readAll(): Record<string, RunConfig> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, RunConfig>
  } catch {
    return {}
  }
}

function mergedConfig(saved: Partial<RunConfig>, detected: RunConfig): RunConfig {
  const fuelType = saved.fuelType || detected.fuelType
  const merged = {
    ...detected,
    ...saved,
    fuelType,
    oxidizer: { ...detected.oxidizer, ...(saved.oxidizer || {}) },
    fuel: { ...detected.fuel, ...(saved.fuel || {}) },
  }
  if (!merged.fuel.densityKgM3 && fuelType !== 'custom') {
    merged.fuel.densityKgM3 = nominalFuelDensity(fuelType)
  }
  return merged
}

export function loadRunConfig(file: TelemetryFile): RunConfig {
  return mergedConfig(readAll()[runConfigKey(file)] || {}, detectedRunConfig(file))
}

export function saveRunConfig(file: TelemetryFile, config: RunConfig) {
  try {
    const all = readAll()
    all[runConfigKey(file)] = config
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // The analysis can still run for this session if storage is unavailable.
  }
}

export function resetRunConfig(file: TelemetryFile) {
  try {
    const all = readAll()
    delete all[runConfigKey(file)]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Ignore unavailable storage.
  }
  return detectedRunConfig(file)
}
