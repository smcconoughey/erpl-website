import type { Channel, TelemetryEvent, TelemetryFile } from '../types'

const TIME_NAME = /^(timestamp|time_stamp|datetime|date_time|time|t|elapsed_s|elapsed|t_s|t_sec|seconds|sec)$/i
const ELAPSED_NAME = /elapsed/i
const ABS_NAME = /timestamp|datetime|date/i
const EVENT_NAME = /^(event|events|msg|message|comment|note|notes|log)$/i

function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t'] as const
  let best: (typeof candidates)[number] = ','
  let bestCount = -1
  for (const d of candidates) {
    let count = 0
    let inQ = false
    for (let i = 0; i < headerLine.length; i++) {
      const ch = headerLine[i]
      if (ch === '"') inQ = !inQ
      else if (!inQ && ch === d) count += 1
    }
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

function parseLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQ = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === delim) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function coerceNumber(v: string): number {
  if (v === '' || v == null) return NaN
  const n = Number(v)
  if (Number.isFinite(n)) return n
  const s = v.trim().toLowerCase()
  if (s === 'on' || s === 'true' || s === 'open' || s === 'enabled' || s === 'armed' || s === 'high') return 1
  if (s === 'off' || s === 'false' || s === 'closed' || s === 'disabled' || s === 'low') return 0
  return NaN
}

function parseAbsSeconds(v: string): number {
  if (v === '' || v == null) return NaN
  const n = Number(v)
  if (Number.isFinite(n)) {
    if (n > 1e12) return n / 1000
    if (n > 1e9) return n
    return NaN
  }
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms / 1000 : NaN
}

export function extractUnit(name: string): string {
  const m = name.match(/\(([^)]+)\)\s*$/)
  if (m) return m[1]
  const lower = name.toLowerCase()
  if (/(^|[\s_-])(state|status)([\s_-]|$)/.test(lower)) return 'state'
  if (/\b(enabled|armed|press|vent)\b/.test(lower)) return 'flag'
  return ''
}

export function channelGroup(name: string): string {
  const n = name.trim()
  if (/^bb[-_]/i.test(n) || /bang/i.test(n)) return 'Bang-bang'
  if (/^pt\d/i.test(n) || /\(psi\)/i.test(n) || /pressure/i.test(n)) return 'Pressure'
  if (/^lc\d/i.test(n) || /thrust/i.test(n) || /\(lbf\)/i.test(n) || /load/i.test(n)) return 'Load / Thrust'
  if (/^tc\d/i.test(n) || /deg[fc]/i.test(n) || /temp/i.test(n)) return 'Temperature'
  if (/^dc\d/i.test(n) || /state|armed|enabled|sequence/i.test(n)) return 'Discrete'
  return 'Other'
}

function isStepChannel(values: Float64Array, unit: string): boolean {
  if (unit === 'state' || unit === 'flag') return true
  const seen = new Set<number>()
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    seen.add(Math.round(v * 1e6) / 1e6)
    if (seen.size > 6) return false
  }
  if (seen.size === 0) return false
  for (const v of seen) {
    if (Math.abs(v - Math.round(v)) > 1e-6) return false
  }
  return true
}

function eventPriority(label: string): 'info' | 'event' {
  if (/^\s*\[info\]/i.test(label)) return 'info'
  return 'event'
}

export function parseCsvText(
  text: string,
  meta: { id: string; name: string; folder: string },
): TelemetryFile {
  let raw = text
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (raw.endsWith('\n')) raw = raw.slice(0, -1)
  const lines = raw.split('\n')
  if (lines.length < 2) throw new Error(`${meta.name}: empty CSV`)

  const delim = detectDelimiter(lines[0])
  const headers = parseLine(lines[0], delim).map((h) => h.trim())
  if (headers.length < 2) throw new Error(`${meta.name}: could not detect columns`)

  const rowCount = lines.length - 1
  const probe = Math.min(rowCount, 220)
  const numericHits = new Float64Array(headers.length)
  const absHits = new Float64Array(headers.length)

  for (let r = 0; r < probe; r++) {
    const cells = parseLine(lines[r + 1], delim)
    for (let c = 0; c < headers.length; c++) {
      const cell = cells[c] ?? ''
      if (!EVENT_NAME.test(headers[c]) && Number.isFinite(coerceNumber(cell))) numericHits[c] += 1
      if ((ABS_NAME.test(headers[c]) || TIME_NAME.test(headers[c])) && Number.isFinite(parseAbsSeconds(cell))) {
        absHits[c] += 1
      }
    }
  }

  const numericRatio = [...numericHits].map((h) => (probe === 0 ? 0 : h / probe))
  const absRatio = [...absHits].map((h) => (probe === 0 ? 0 : h / probe))

  let elapsedIdx = headers.findIndex((h) => ELAPSED_NAME.test(h))
  if (elapsedIdx < 0 || numericRatio[elapsedIdx] < 0.5) {
    elapsedIdx = headers.findIndex((h, i) => TIME_NAME.test(h) && numericRatio[i] >= 0.5 && !ABS_NAME.test(h))
  }

  let absIdx = headers.findIndex((h, i) => ABS_NAME.test(h) && absRatio[i] >= 0.5)
  if (absIdx < 0) {
    absIdx = headers.findIndex((h, i) => TIME_NAME.test(h) && absRatio[i] >= 0.8 && i !== elapsedIdx)
  }

  if (elapsedIdx < 0 && absIdx < 0) {
    elapsedIdx = numericRatio.findIndex((h) => h >= 0.8)
  }
  if (elapsedIdx < 0 && absIdx < 0) {
    throw new Error(`${meta.name}: no time column found`)
  }

  const tElapsed = new Float64Array(rowCount)
  const tAbs = new Float64Array(rowCount)
  const valueCols: { index: number; values: Float64Array; finite: number }[] = []
  const eventCols: { index: number; labels: string[] }[] = []

  for (let c = 0; c < headers.length; c++) {
    if (c === elapsedIdx || c === absIdx) continue
    if (EVENT_NAME.test(headers[c])) {
      eventCols.push({ index: c, labels: new Array(rowCount).fill('') })
    } else if (numericRatio[c] >= 0.4) {
      valueCols.push({ index: c, values: new Float64Array(rowCount), finite: 0 })
    }
  }

  for (let r = 0; r < rowCount; r++) {
    const cells = parseLine(lines[r + 1], delim)
    if (elapsedIdx >= 0) tElapsed[r] = coerceNumber(cells[elapsedIdx] ?? '')
    if (absIdx >= 0) tAbs[r] = parseAbsSeconds(cells[absIdx] ?? '')
    for (const col of valueCols) {
      const v = coerceNumber(cells[col.index] ?? '')
      col.values[r] = v
      if (Number.isFinite(v)) col.finite += 1
    }
    for (const col of eventCols) {
      col.labels[r] = (cells[col.index] ?? '').trim()
    }
  }

  let hasAbsolute = absIdx >= 0
  if (elapsedIdx < 0 && absIdx >= 0) {
    const t0 = tAbs[0]
    for (let r = 0; r < rowCount; r++) tElapsed[r] = tAbs[r] - t0
  }
  if (absIdx < 0 && elapsedIdx >= 0) {
    tAbs.set(tElapsed)
    hasAbsolute = false
  }

  const events: TelemetryEvent[] = []
  for (const col of eventCols) {
    for (let r = 0; r < rowCount; r++) {
      const label = col.labels[r]
      if (!label) continue
      events.push({
        tElapsed: tElapsed[r],
        tAbs: tAbs[r],
        label,
        priority: eventPriority(label),
      })
    }
  }

  const channels: Channel[] = []
  for (const col of valueCols) {
    if (col.finite < Math.max(4, rowCount * 0.05)) continue
    const name = headers[col.index]
    const unit = extractUnit(name)
    channels.push({
      key: `${meta.id}::${name}`,
      fileId: meta.id,
      name,
      unit,
      group: channelGroup(name),
      step: isStepChannel(col.values, unit),
      values: col.values,
    })
  }

  if (channels.length === 0) throw new Error(`${meta.name}: no numeric channels found`)

  return {
    id: meta.id,
    name: meta.name,
    folder: meta.folder,
    rowCount,
    tElapsed,
    tAbs,
    hasAbsolute,
    channels,
    events,
  }
}
