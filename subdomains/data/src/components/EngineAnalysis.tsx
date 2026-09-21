import { useEffect, useMemo, useState } from 'react'
import { loadRunConfig, type RunConfig } from '../lib/dataConfig'
import { detectedFiringWindow, runEngineAnalysis, type EngineAnalysisResult } from '../lib/engineAnalysis'
import { fmtNum } from '../lib/math'
import { useTelemetry } from '../store'
import type { TelemetryFile } from '../types'

function finiteInput(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function EngineAnalysis({ onConfigure }: { onConfigure: () => void }) {
  const { files, plots, dispatch } = useTelemetry()
  const sourceFiles = useMemo(() => files.filter((file) => !file.id.startsWith('analysis:')), [files])
  const [sourceId, setSourceId] = useState('')
  const source = sourceFiles.find((file) => file.id === sourceId) || sourceFiles[0] || null
  const [config, setConfig] = useState<RunConfig | null>(null)
  const [start, setStart] = useState('0')
  const [end, setEnd] = useState('')
  const [result, setResult] = useState<EngineAnalysisResult | null>(null)
  const [resultFileId, setResultFileId] = useState('')
  const [error, setError] = useState('')
  const [windowSource, setWindowSource] = useState('')

  function applyDetectedWindow(file: TelemetryFile, runConfig: RunConfig) {
    const detected = detectedFiringWindow(file, runConfig)
    setStart(detected ? String(Number(detected.start.toFixed(4))) : '0')
    setEnd(detected ? String(Number(detected.end.toFixed(4))) : '')
    setWindowSource(detected?.source || '')
  }

  useEffect(() => {
    if (!source) {
      setConfig(null)
      setResult(null)
      return
    }
    if (source.id !== sourceId) setSourceId(source.id)
    const loaded = loadRunConfig(source)
    setConfig(loaded)
    applyDetectedWindow(source, loaded)
    setResult(null)
    setError('')
  }, [source?.id])

  const plotted = new Set(plots.flatMap((plot) => plot.series.map((series) => series.channelKey)))

  function analyze(file: TelemetryFile, runConfig: RunConfig) {
    setError('')
    try {
      const analysis = runEngineAnalysis(file, runConfig, finiteInput(start) ?? 0, finiteInput(end))
      const fileId = `analysis:engine:${file.id}`
      if (analysis.metrics.length) {
        dispatch({
          type: 'upsert-file',
          file: {
            id: fileId,
            name: `Performance — ${file.name.replace(/\.csv$/i, '')}`,
            folder: 'Analysis',
            rowCount: file.rowCount,
            tElapsed: file.tElapsed,
            tAbs: file.tAbs,
            hasAbsolute: file.hasAbsolute,
            events: [],
            channels: analysis.metrics.map((metric) => ({
              key: `${fileId}::${metric.id}`,
              fileId,
              name: metric.name,
              unit: metric.unit,
              group: 'Engine performance',
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

  return <section className="cea-panel tab-panel">
    <div className="side-head">
      <div><div className="kicker">Inverse performance</div><h2>Engine analysis</h2></div>
      <button type="button" className="tiny" onClick={onConfigure}>Config</button>
    </div>
    <p className="hint">Derive venturi mass flows, O/F, Isp, Cf, c*, and effective throat geometry from the saved run configuration.</p>
    <label className="cea-field">Run
      <select value={source?.id || ''} disabled={!sourceFiles.length} onChange={(event) => setSourceId(event.target.value)}>
        {sourceFiles.length === 0 ? <option value="">Load a CSV first</option> : sourceFiles.map((file) =>
          <option key={file.id} value={file.id}>{file.name.replace(/\.csv$/i, '')}</option>)}
      </select>
    </label>
    <div className="cea-time-grid">
      <label className="cea-field">Start (s)
        <input type="number" step="any" value={start} onChange={(event) => setStart(event.target.value)} />
      </label>
      <label className="cea-field">End (s)
        <input type="number" step="any" placeholder="End of run" value={end} onChange={(event) => setEnd(event.target.value)} />
      </label>
      <button type="button" className="btn compact" disabled={!source || !config}
        onClick={() => source && config && applyDetectedWindow(source, config)}>Auto firing window</button>
      {windowSource && <span className="window-source">Detected from {windowSource}</span>}
    </div>
    <div className="analysis-basis">
      <span>Solve basis</span>
      <strong>{config?.solveBasis === 'throat-area' ? 'Known throat area' : config?.solveBasis === 'cf' ? 'Reference Cf' : 'Reference c*'}</strong>
      <button type="button" className="tiny" onClick={onConfigure}>Edit</button>
    </div>
    <button type="button" className="btn accent cea-run" disabled={!source || !config}
      onClick={() => source && config && analyze(source, config)}>Calculate + create channels</button>
    {error && <p className="cea-error" role="alert">{error}</p>}
    {result && <div className="cea-results">
      <div className="cea-window">{result.samples.toLocaleString()} samples · {fmtNum(result.t0, 3)} to {fmtNum(result.t1, 3)} s</div>
      {result.averages.map((item) => <div className="cea-result" key={item.label}>
        <span>{item.label}</span><strong>{fmtNum(item.value, 3)} {item.unit}</strong>
      </div>)}
      {result.metrics.map((metric) => {
        const key = `${resultFileId}::${metric.id}`
        return <div className="cea-result metric" key={metric.id}>
          <span>{metric.name}</span><strong>{fmtNum(metric.average, 3)} {metric.unit}</strong>
          <button type="button" className={`btn compact${plotted.has(key) ? ' on' : ''}`}
            onClick={() => dispatch({ type: 'toggle-channel', channelKey: key })}>{plotted.has(key) ? 'Plotted' : 'Plot'}</button>
        </div>
      })}
      {result.notes.map((note) => <p className="analysis-note" key={note}>{note}</p>)}
      {result.warnings.length > 0 && <ul className="cea-warnings">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </div>}
  </section>
}
