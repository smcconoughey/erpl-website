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

type CeaResult = {
  solver: string
  version: string
  converged: boolean
  fuelModel: string
  mode: 'equilibrium' | 'frozen'
  chamberTemperatureK: number
  chamberGamma: number
  chamberMolecularWeight: number
  cStarMps: number
  cf: number
  ispSeconds: number
  ispVacuumSeconds: number
  exitTemperatureK: number
  exitPressureBar: number
  exitMach: number
  exitAreaRatio: number
  chamberSpecies: { name: string; moleFraction: number }[]
}

function positiveConfig(value: string) {
  const parsed = finiteInput(value)
  return parsed !== null && parsed > 0 ? parsed : null
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
  const [ceaResult, setCeaResult] = useState<CeaResult | null>(null)
  const [ceaError, setCeaError] = useState('')
  const [ceaLoading, setCeaLoading] = useState(false)

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
    setCeaResult(null)
    setCeaError('')
  }, [source?.id])

  const plotted = new Set(plots.flatMap((plot) => plot.series.map((series) => series.channelKey)))

  async function analyze(file: TelemetryFile, runConfig: RunConfig) {
    setError('')
    setCeaError('')
    setCeaResult(null)
    let measuredReady = false
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
      measuredReady = true

      if (runConfig.fuelType === 'custom') {
        setCeaError('NASA CEA currently supports the IPA and ethanol fuel selections.')
        return
      }
      const measuredPc = analysis.averages.find((item) => item.label === 'Chamber pressure')?.value
      const measuredOf = analysis.metrics.find((metric) => metric.id === 'of-ratio')?.average
      const chamberPressurePsi = positiveConfig(runConfig.ceaChamberPressurePsi) ?? measuredPc
      const ofRatio = positiveConfig(runConfig.ceaOfRatio) ?? measuredOf
      if (!chamberPressurePsi || !Number.isFinite(chamberPressurePsi) || !ofRatio || !Number.isFinite(ofRatio)) {
        setCeaError('NASA CEA needs chamber pressure and O/F. Map both venturis or enter Pc and O/F overrides in Config.')
        return
      }
      const request = {
        fuel: runConfig.fuelType,
        mode: runConfig.ceaMode,
        chamberPressurePsi,
        ofRatio,
        expansionRatio: positiveConfig(runConfig.ceaExpansionRatio),
        ambientPressurePsi: positiveConfig(runConfig.ceaAmbientPressurePsi),
        fuelTemperatureK: positiveConfig(runConfig.fuelTemperatureK),
        oxidizerTemperatureK: positiveConfig(runConfig.oxidizerTemperatureK),
      }
      if (Object.values(request).some((value) => value === null)) {
        setCeaError('Complete the NASA CEA conditions in Config.')
        return
      }
      setCeaLoading(true)
      const response = await fetch('/api/online/cea/rocket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'NASA CEA could not solve this operating point.')
      setCeaResult(payload.result as CeaResult)
    } catch (caught) {
      if (measuredReady) setCeaError(caught instanceof Error ? caught.message : String(caught))
      else {
        setResult(null)
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setCeaLoading(false)
    }
  }

  return <section className="cea-panel tab-panel">
    <div className="side-head">
      <div><div className="kicker">Inverse performance</div><h2>Engine analysis</h2></div>
      <button type="button" className="tiny" onClick={onConfigure}>Config</button>
    </div>
    <p className="hint">Back out measured performance, then run the official NASA CEA Python solver at the average operating point.</p>
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
    <button type="button" className="btn accent cea-run" disabled={!source || !config || ceaLoading}
      onClick={() => source && config && analyze(source, config)}>{ceaLoading ? 'Running NASA CEA…' : 'Calculate + run NASA CEA'}</button>
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
    {ceaError && <p className="cea-error" role="alert">{ceaError}</p>}
    {ceaResult && <div className="cea-reference">
      <div className="cea-reference-head">
        <div><span className="kicker">Chemical equilibrium</span><strong>NASA CEA {ceaResult.version}</strong></div>
        <span className="cea-converged">Converged</span>
      </div>
      <p>{ceaResult.mode === 'frozen' ? 'Frozen from throat' : 'Equilibrium expansion'} · {ceaResult.fuelModel}</p>
      <div className="cea-reference-grid">
        <span>Chamber T<strong>{fmtNum(ceaResult.chamberTemperatureK, 1)} K</strong></span>
        <span>Ideal c*<strong>{fmtNum(ceaResult.cStarMps / 0.3048, 1)} ft/s</strong></span>
        <span>Ideal Cf<strong>{fmtNum(ceaResult.cf, 4)}</strong></span>
        <span>Ideal Isp<strong>{fmtNum(ceaResult.ispSeconds, 2)} s</strong></span>
        <span>Vacuum Isp<strong>{fmtNum(ceaResult.ispVacuumSeconds, 2)} s</strong></span>
        <span>Chamber γ<strong>{fmtNum(ceaResult.chamberGamma, 4)}</strong></span>
        <span>Molecular wt.<strong>{fmtNum(ceaResult.chamberMolecularWeight, 3)}</strong></span>
        <span>Exit Mach<strong>{fmtNum(ceaResult.exitMach, 3)}</strong></span>
      </div>
      <p className="cea-species">Chamber: {ceaResult.chamberSpecies.map((species) =>
        `${species.name} ${(species.moleFraction * 100).toFixed(1)}%`).join(' · ')}</p>
    </div>}
  </section>
}
