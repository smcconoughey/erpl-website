import { useEffect, useMemo, useState } from 'react'
import { bestChannel, runQuickAnalysis, type QuickAnalysis } from '../lib/ceaAnalysis'
import { fmtNum } from '../lib/math'
import { useTelemetry } from '../store'
import type { Channel, TelemetryFile } from '../types'

const PREFS_KEY = 'datanator.cea-quick-inputs'

type Mappings = {
  pressure: string
  thrust: string
  totalFlow: string
  oxidizerFlow: string
  fuelFlow: string
}

type FixedInputs = {
  throatDiameterIn: string
  fixedCf: string
  idealCstarFtS: string
}

const EMPTY_MAPPINGS: Mappings = { pressure: '', thrust: '', totalFlow: '', oxidizerFlow: '', fuelFlow: '' }

function loadFixedInputs(): FixedInputs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<FixedInputs>
    return {
      throatDiameterIn: saved.throatDiameterIn || '',
      fixedCf: saved.fixedCf || '',
      idealCstarFtS: saved.idealCstarFtS || '',
    }
  } catch {
    return { throatDiameterIn: '', fixedCf: '', idealCstarFtS: '' }
  }
}

function finiteInput(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function channelLabel(channel: Channel) {
  if (!channel.unit || channel.name.toLowerCase().includes(`(${channel.unit.toLowerCase()})`)) return channel.name
  return `${channel.name} (${channel.unit})`
}

function detectedMappings(file: TelemetryFile): Mappings {
  return {
    pressure: bestChannel(file, 'pressure'),
    thrust: bestChannel(file, 'thrust'),
    totalFlow: bestChannel(file, 'totalFlow'),
    oxidizerFlow: bestChannel(file, 'oxidizerFlow'),
    fuelFlow: bestChannel(file, 'fuelFlow'),
  }
}

function detectedEnd(file: TelemetryFile, pressureKey: string) {
  const pressure = file.channels.find((channel) => channel.key === pressureKey)
  if (!pressure) return ''
  let peak = -Infinity
  for (let i = 0; i < file.rowCount; i++) {
    if (file.tElapsed[i] >= 0 && Number.isFinite(pressure.values[i])) peak = Math.max(peak, pressure.values[i])
  }
  if (!Number.isFinite(peak) || peak <= 0) return ''
  const threshold = peak * 0.1
  let last = -1
  for (let i = 0; i < file.rowCount; i++) {
    if (file.tElapsed[i] >= 0 && pressure.values[i] >= threshold) last = i
  }
  if (last < 0 || last >= file.rowCount - 1) return ''
  return String(Number(file.tElapsed[last].toFixed(4)))
}

export function CeaAnalysis() {
  const { files, plots, dispatch } = useTelemetry()
  const sourceFiles = useMemo(() => files.filter((file) => !file.id.startsWith('analysis:cea:')), [files])
  const [sourceId, setSourceId] = useState('')
  const source = sourceFiles.find((file) => file.id === sourceId) || sourceFiles[0] || null
  const [mappings, setMappings] = useState<Mappings>(EMPTY_MAPPINGS)
  const [fixed, setFixed] = useState<FixedInputs>(loadFixedInputs)
  const [start, setStart] = useState('0')
  const [end, setEnd] = useState('')
  const [result, setResult] = useState<QuickAnalysis | null>(null)
  const [resultFileId, setResultFileId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!source) return
    if (source.id !== sourceId) setSourceId(source.id)
  }, [source, sourceId])

  useEffect(() => {
    if (!source) {
      setMappings(EMPTY_MAPPINGS)
      setResult(null)
      return
    }
    applyAuto(source)
    setResult(null)
    setError('')
  }, [source?.id])

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(fixed)) } catch { /* ignore quota */ }
  }, [fixed])

  const channel = (key: string): Channel | null => source?.channels.find((candidate) => candidate.key === key) || null
  const plotted = new Set(plots.flatMap((plot) => plot.series.map((series) => series.channelKey)))

  function applyAuto(file: TelemetryFile) {
    const detected = detectedMappings(file)
    setMappings(detected)
    setStart('0')
    setEnd(detectedEnd(file, detected.pressure))
  }

  function analyze() {
    if (!source) return
    setError('')
    try {
      const analysis = runQuickAnalysis({
        file: source,
        pressure: channel(mappings.pressure),
        thrust: channel(mappings.thrust),
        totalFlow: channel(mappings.totalFlow),
        oxidizerFlow: channel(mappings.oxidizerFlow),
        fuelFlow: channel(mappings.fuelFlow),
        start: finiteInput(start) ?? 0,
        end: finiteInput(end),
        throatDiameterIn: finiteInput(fixed.throatDiameterIn),
        fixedCf: finiteInput(fixed.fixedCf),
        idealCstarFtS: finiteInput(fixed.idealCstarFtS),
      })
      const fileId = `analysis:cea:${source.id}`
      if (analysis.metrics.length) {
        dispatch({
          type: 'upsert-file',
          file: {
            id: fileId,
            name: `Performance — ${source.name.replace(/\.csv$/i, '')}`,
            folder: 'Analysis',
            rowCount: source.rowCount,
            tElapsed: source.tElapsed,
            tAbs: source.tAbs,
            hasAbsolute: source.hasAbsolute,
            events: [],
            channels: analysis.metrics.map((metric) => ({
              key: `${fileId}::${metric.id}`,
              fileId,
              name: metric.name,
              unit: metric.unit,
              group: 'CEA / Performance',
              step: false,
              values: metric.values,
            })),
          },
        })
      }
      setResultFileId(fileId)
      setResult(analysis)
    } catch (caught) {
      setResult(null)
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <section className="cea-panel">
      <div className="side-head">
        <div>
          <div className="kicker">Inverse performance</div>
          <h2>CEA analysis <span className="beta">Beta</span></h2>
        </div>
        <button type="button" className="tiny" disabled={!source}
          title="Re-detect channels and firing window" onClick={() => source && applyAuto(source)}>Auto</button>
      </div>
      <p className="hint">Fast first-pass estimates from telemetry and fixed assumptions. NASA CEA equilibrium solving is the next backend stage.</p>

      <label className="cea-field">Run
        <select value={source?.id || ''} disabled={!sourceFiles.length}
          onChange={(event) => setSourceId(event.target.value)}>
          {sourceFiles.length === 0 ? <option value="">Load a CSV first</option> : sourceFiles.map((file) => (
            <option key={file.id} value={file.id}>{file.name.replace(/\.csv$/i, '')}</option>
          ))}
        </select>
      </label>

      <div className="cea-time-grid">
        <label className="cea-field">Start (s)
          <input type="number" step="any" value={start} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="cea-field">End (s)
          <input type="number" step="any" placeholder="End of run" value={end}
            onChange={(event) => setEnd(event.target.value)} />
        </label>
        <button type="button" className="btn compact" disabled={!source}
          onClick={() => source && applyAuto(source)}>Auto firing window</button>
      </div>

      <details className="cea-details" open>
        <summary>Telemetry mapping</summary>
        <ChannelSelect label="Chamber pressure" value={mappings.pressure} file={source}
          onChange={(value) => setMappings((current) => ({ ...current, pressure: value }))} />
        <ChannelSelect label="Thrust" value={mappings.thrust} file={source}
          onChange={(value) => setMappings((current) => ({ ...current, thrust: value }))} />
        <ChannelSelect label="Total mass flow" optional value={mappings.totalFlow} file={source}
          onChange={(value) => setMappings((current) => ({ ...current, totalFlow: value }))} />
        <ChannelSelect label="Oxidizer flow" optional value={mappings.oxidizerFlow} file={source}
          onChange={(value) => setMappings((current) => ({ ...current, oxidizerFlow: value }))} />
        <ChannelSelect label="Fuel flow" optional value={mappings.fuelFlow} file={source}
          onChange={(value) => setMappings((current) => ({ ...current, fuelFlow: value }))} />
      </details>

      <details className="cea-details" open>
        <summary>Fixed assumptions</summary>
        <div className="cea-fixed-grid">
          <label className="cea-field">Throat Ø (in)
            <input type="number" min="0" step="any" placeholder="Required for Cf / c*"
              value={fixed.throatDiameterIn}
              onChange={(event) => setFixed((current) => ({ ...current, throatDiameterIn: event.target.value }))} />
          </label>
          <label className="cea-field">Fixed Cf
            <input type="number" min="0" step="any" placeholder="e.g. 1.45" value={fixed.fixedCf}
              onChange={(event) => setFixed((current) => ({ ...current, fixedCf: event.target.value }))} />
          </label>
          <label className="cea-field">Ideal c* (ft/s)
            <input type="number" min="0" step="any" placeholder="CEA reference"
              value={fixed.idealCstarFtS}
              onChange={(event) => setFixed((current) => ({ ...current, idealCstarFtS: event.target.value }))} />
          </label>
        </div>
      </details>

      <button type="button" className="btn accent cea-run" disabled={!source || !mappings.pressure} onClick={analyze}>
        Calculate + create channels
      </button>
      {error && <p className="cea-error" role="alert">{error}</p>}
      {result && (
        <div className="cea-results">
          <div className="cea-window">{result.samples.toLocaleString()} samples · {fmtNum(result.t0, 3)} to {fmtNum(result.t1, 3)} s</div>
          {result.averages.map((item) => (
            <div className="cea-result" key={item.label}>
              <span>{item.label}</span><strong>{fmtNum(item.value, 3)} {item.unit}</strong>
            </div>
          ))}
          {result.metrics.map((metric) => {
            const key = `${resultFileId}::${metric.id}`
            return (
              <div className="cea-result metric" key={metric.id}>
                <span>{metric.name}</span>
                <strong>{fmtNum(metric.average, 3)} {metric.unit}</strong>
                <button type="button" className={`btn compact${plotted.has(key) ? ' on' : ''}`}
                  onClick={() => dispatch({ type: 'toggle-channel', channelKey: key })}>
                  {plotted.has(key) ? 'Plotted' : 'Plot'}
                </button>
              </div>
            )
          })}
          {result.metrics.length === 0 && <p className="empty-lite">Add fixed assumptions or flow channels to create derived series.</p>}
          {result.warnings.length > 0 && <ul className="cea-warnings">
            {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>}
        </div>
      )}
    </section>
  )
}

function ChannelSelect({ label, optional = false, value, file, onChange }: {
  label: string
  optional?: boolean
  value: string
  file: TelemetryFile | null
  onChange: (value: string) => void
}) {
  return (
    <label className="cea-field">{label}{optional && <em>optional</em>}
      <select value={value} disabled={!file} onChange={(event) => onChange(event.target.value)}>
        <option value="">{optional ? 'Not mapped' : 'Select a channel'}</option>
        {file?.channels.map((channel) => (
          <option key={channel.key} value={channel.key}>{channelLabel(channel)}</option>
        ))}
      </select>
    </label>
  )
}
