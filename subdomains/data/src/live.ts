import { useCallback, useEffect, useRef, useState } from 'react'
import { channelGroup, extractUnit } from './lib/csv'
import { useTelemetry } from './store'
import type { Channel, TelemetryEvent, TelemetryFile } from './types'

const LIVE_FLUSH_MS = 1000
const MAX_LIVE_SAMPLES = 7200

export type LiveSample = {
  stream: string
  timestamp: string
  receivedAt: string
  values: Record<string, number | boolean | string | null>
  event?: string
}

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting'

function liveFile(stream: string, samples: LiveSample[]): TelemetryFile | null {
  const rows = samples.flatMap((sample) => {
    const tAbs = Date.parse(sample.timestamp) / 1000
    return Number.isFinite(tAbs) ? [{ sample, tAbs }] : []
  }).sort((a, b) => a.tAbs - b.tAbs)
  if (!rows.length) return null
  const id = `live:${stream}`
  const first = rows[0].tAbs
  const tElapsed = Float64Array.from(rows, (row) => row.tAbs - first)
  const tAbs = Float64Array.from(rows, (row) => row.tAbs)
  const names = new Set<string>()
  rows.forEach(({ sample }) => Object.entries(sample.values).forEach(([name, value]) => {
    if (typeof value === 'number' || typeof value === 'boolean') names.add(name)
  }))
  const channels: Channel[] = [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((name) => {
    const values = new Float64Array(rows.length)
    values.fill(Number.NaN)
    let discrete = true
    rows.forEach(({ sample }, index) => {
      const value = sample.values[name]
      if (typeof value === 'boolean') values[index] = value ? 1 : 0
      else if (typeof value === 'number' && Number.isFinite(value)) {
        values[index] = value
        if (value !== 0 && value !== 1) discrete = false
      }
    })
    const unit = extractUnit(name)
    return { key: `${id}::${name}`, fileId: id, name, unit, group: channelGroup(name),
      step: unit === 'state' || unit === 'flag' || discrete, values }
  })
  const events: TelemetryEvent[] = rows.flatMap(({ sample, tAbs: eventAbs }, index) => sample.event ? [{
    tElapsed: tElapsed[index], tAbs: eventAbs, label: sample.event, priority: 'event' as const,
  }] : [])
  return { id, name: `${stream} (live)`, folder: 'Live', rowCount: rows.length,
    tElapsed, tAbs, hasAbsolute: true, channels, events }
}

export function useLiveTelemetry() {
  const { dispatch } = useTelemetry()
  const [stream, setStream] = useState('')
  const [status, setStatus] = useState<LiveStatus>('idle')
  const [sampleCount, setSampleCount] = useState(0)
  const [error, setError] = useState('')
  const sourceRef = useRef<EventSource | null>(null)
  const streamRef = useRef('')
  const pendingRef = useRef<LiveSample[]>([])
  const samplesRef = useRef<LiveSample[]>([])
  const plottedRef = useRef(false)

  const disconnect = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    setStatus('idle')
  }, [])

  const connect = useCallback((nextStream: string) => {
    const trimmed = nextStream.trim()
    if (!trimmed || trimmed.length > 64 || trimmed.startsWith('.') || /[\\/:\u0000-\u001f]/.test(trimmed)) {
      setError('Use a stream name of 1–64 characters without slashes or colons.')
      return false
    }
    sourceRef.current?.close()
    pendingRef.current = []
    samplesRef.current = []
    plottedRef.current = false
    streamRef.current = trimmed
    setStream(trimmed)
    setSampleCount(0)
    setError('')
    setStatus('connecting')
    const source = new EventSource(`/api/online/streams/${encodeURIComponent(trimmed)}/events`)
    sourceRef.current = source
    source.addEventListener('ready', () => setStatus('live'))
    source.addEventListener('sample', (event) => {
      try {
        const sample = JSON.parse((event as MessageEvent).data) as LiveSample
        if (sample.stream === streamRef.current) pendingRef.current.push(sample)
      } catch { setError('A live sample could not be decoded.') }
    })
    source.onerror = () => {
      if (sourceRef.current === source) setStatus('reconnecting')
    }
    return true
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!pendingRef.current.length || !streamRef.current) return
      samplesRef.current = [...samplesRef.current, ...pendingRef.current]
        .slice(-MAX_LIVE_SAMPLES)
      pendingRef.current = []
      const file = liveFile(streamRef.current, samplesRef.current)
      if (!file) return
      dispatch({ type: 'upsert-file', file })
      setSampleCount(file.rowCount)
      if (!plottedRef.current && file.channels[0]) {
        plottedRef.current = true
        dispatch({ type: 'toggle-channel', channelKey: file.channels[0].key })
      }
    }, LIVE_FLUSH_MS)
    return () => window.clearInterval(timer)
  }, [dispatch])

  useEffect(() => () => sourceRef.current?.close(), [])

  return { stream, status, sampleCount, error, connect, disconnect, updateStream: setStream }
}
