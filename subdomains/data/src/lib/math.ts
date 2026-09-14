export function lowerBound(t: Float64Array, x: number): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function nearestIndex(t: Float64Array, x: number): number {
  if (t.length === 0) return 0
  const i = lowerBound(t, x)
  if (i <= 0) return 0
  if (i >= t.length) return t.length - 1
  return x - t[i - 1] <= t[i] - x ? i - 1 : i
}

export function sampleAt(
  t: Float64Array,
  y: Float64Array,
  x: number,
  step: boolean,
): number {
  const n = t.length
  if (n === 0) return NaN
  if (x <= t[0]) return y[0]
  if (x >= t[n - 1]) return y[n - 1]
  const i = lowerBound(t, x)
  if (i <= 0) return y[0]
  const i0 = i - 1
  const y0 = y[i0]
  const y1 = y[i]
  if (!Number.isFinite(y0)) return y1
  if (!Number.isFinite(y1) || step) return y0
  const t0 = t[i0]
  const t1 = t[i]
  const span = t1 - t0
  if (span === 0) return y0
  return y0 + ((x - t0) / span) * (y1 - y0)
}

/** Inclusive-exclusive index range covering [t0, t1], plus one sample on each side. */
export function visibleBounds(t: Float64Array, t0: number, t1: number): { i0: number; i1: number } {
  if (t.length === 0) return { i0: 0, i1: 0 }
  let i0 = lowerBound(t, t0)
  if (i0 > 0) i0 -= 1
  let i1 = lowerBound(t, t1)
  if (i1 < t.length && t[i1] <= t1) i1 += 1
  if (i1 < t.length) i1 += 1
  return { i0, i1 }
}

export function windowRange(
  t: Float64Array,
  y: Float64Array,
  t0: number,
  t1: number,
): { min: number; max: number } | null {
  const { i0, i1 } = visibleBounds(t, t0, t1)
  let min = Infinity
  let max = -Infinity
  for (let i = i0; i < i1; i++) {
    const v = y[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

export function padRange(min: number, max: number, step: boolean): { min: number; max: number } {
  if (step && min >= -0.05 && max <= 1.05) return { min: -0.15, max: 1.15 }
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.05, 1)
    return { min: min - pad, max: max + pad }
  }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min
  if (!Number.isFinite(span) || span <= 0) return [min]
  const raw = span / Math.max(count, 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const err = raw / mag
  const step = err >= 7.5 ? 10 * mag : err >= 3 ? 5 * mag : err >= 1.5 ? 2 * mag : mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  const end = max + step * 1e-6
  for (let v = start; v <= end; v += step) {
    const tick = Math.abs(v) < step * 1e-10 ? 0 : Number(v.toPrecision(12))
    ticks.push(tick)
  }
  return ticks
}

export function minMaxBuckets(
  t: Float64Array,
  y: Float64Array,
  t0: number,
  t1: number,
  buckets: number,
): { mins: Float64Array; maxs: Float64Array; counts: Uint16Array } {
  const mins = new Float64Array(buckets)
  const maxs = new Float64Array(buckets)
  const counts = new Uint16Array(buckets)
  mins.fill(Infinity)
  maxs.fill(-Infinity)
  const span = t1 - t0
  if (span <= 0 || buckets <= 0) return { mins, maxs, counts }
  const { i0, i1 } = visibleBounds(t, t0, t1)
  const inv = buckets / span
  for (let i = i0; i < i1; i++) {
    const v = y[i]
    if (!Number.isFinite(v)) continue
    let b = Math.floor((t[i] - t0) * inv)
    if (b < 0) b = 0
    if (b >= buckets) b = buckets - 1
    if (v < mins[b]) mins[b] = v
    if (v > maxs[b]) maxs[b] = v
    if (counts[b] < 0xffff) counts[b] += 1
  }
  return { mins, maxs, counts }
}

export function fmtNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a === 0) return '0'
  if (a >= 1e6 || a < 1e-3) return n.toExponential(2)
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export function fmtTime(t: number, span: number, absolute: boolean): string {
  if (!Number.isFinite(t)) return '—'
  if (absolute) {
    const d = new Date(t * 1000)
    if (Number.isNaN(d.getTime())) return fmtNum(t, 3)
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    const ss = String(d.getUTCSeconds()).padStart(2, '0')
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0')
    if (span < 2) return `${hh}:${mm}:${ss}.${ms}`
    if (span < 120) return `${hh}:${mm}:${ss}.${ms.slice(0, 2)}`
    return `${hh}:${mm}:${ss}`
  }
  const sign = t < 0 ? '-' : ''
  const a = Math.abs(t)
  if (span < 2) return `${sign}${a.toFixed(3)} s`
  if (span < 120) return `${sign}${a.toFixed(2)} s`
  if (span < 3600) return `${sign}${a.toFixed(1)} s`
  return `${sign}${a.toFixed(0)} s`
}

export const PALETTE = [
  '#4da3ff',
  '#ff6b4a',
  '#3dd68c',
  '#f0c14b',
  '#c084fc',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
  '#e8e1d5',
  '#60a5fa',
  '#fdba74',
  '#34d399',
]

export function colorFor(key: string): string {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return PALETTE[Math.abs(h) % PALETTE.length]
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}
