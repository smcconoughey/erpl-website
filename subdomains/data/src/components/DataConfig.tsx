import { useEffect, useMemo, useState } from 'react'
import {
  detectedRunConfig,
  loadRunConfig,
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

  const autoMap = () => {
    const detected = detectedRunConfig(source)
    commit({
      ...config,
      chamberPressureKey: detected.chamberPressureKey,
      thrustKey: detected.thrustKey,
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
    </details>

    <VenturiFields title="Oxidizer" file={source} value={config.oxidizer} densityHint="e.g. LOX 1141"
      onChange={(value) => update('oxidizer', value)} />
    <VenturiFields title="Fuel" file={source} value={config.fuel} densityHint="Set for propellant"
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
      {config.solveBasis === 'throat-area' && <label className="cea-field">Engine throat area (in²)
        <input type="number" min="0" step="any" placeholder="Known nozzle geometry" value={config.throatAreaIn2}
          onChange={(event) => update('throatAreaIn2', event.target.value)} />
      </label>}
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
