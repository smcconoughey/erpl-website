import { useTelemetry } from '../store'

type Props = {
  onOpenFolder: () => void
  onOpenFiles: () => void
  onOpenOnline: () => void
  onOpenLive: () => void
  onOpenLiveInfo: () => void
  live: boolean
}

export function Toolbar({ onOpenFolder, onOpenFiles, onOpenOnline, onOpenLive, onOpenLiveInfo, live }: Props) {
  const { tool, timeMode, hasAbsolute, loading, fullSpan, dispatch } = useTelemetry()

  return (
    <header className="toolbar">
      <div className="brand">
        <a className="mark-link" href="https://erpl.space/" target="_blank" rel="noopener">
          <img className="mark" src={`${import.meta.env.BASE_URL}erpl-mark.png`} alt="ERPL" />
        </a>
        <div>
          <div className="title">Datanator</div>
          <div className="sub">
            <a href="https://erpl.space/" target="_blank" rel="noopener">
              ERPL
            </a>{' '}
            CSV campaign viewer
          </div>
        </div>
      </div>

      <div className="tool-group">
        <button type="button" className="btn" onClick={onOpenFolder}>
          Open folder
        </button>
        <button type="button" className="btn" onClick={onOpenFiles}>
          Open files
        </button>
        <button type="button" className="btn accent" disabled={Boolean(loading)} onClick={onOpenOnline}>
          Open Online ERPL Data
        </button>
        <span className="live-toolbar">
          <button type="button" className={`btn live-btn${live ? ' on' : ''}`} onClick={onOpenLive}>
            <span className="live-dot" /> Live
          </button>
          <button type="button" className="btn info-btn" title="Live telemetry endpoint setup"
            aria-label="Live telemetry endpoint setup" onClick={onOpenLiveInfo}>ⓘ</button>
        </span>
      </div>

      <div className="tool-group segmented">
        {(['pan', 'zoom', 'measure'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tool === t ? 'on' : ''}
            onClick={() => dispatch({ type: 'set-tool', tool: t })}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="tool-group segmented">
        <button
          type="button"
          className={timeMode === 'elapsed' ? 'on' : ''}
          onClick={() => dispatch({ type: 'set-time-mode', timeMode: 'elapsed' })}
        >
          Elapsed
        </button>
        <button
          type="button"
          className={timeMode === 'absolute' ? 'on' : ''}
          disabled={!hasAbsolute}
          onClick={() => dispatch({ type: 'set-time-mode', timeMode: 'absolute' })}
        >
          Absolute
        </button>
      </div>

      <div className="tool-group">
        <button type="button" className="btn" onClick={() => dispatch({ type: 'add-plot' })}>
          Add plot
        </button>
        <button
          type="button"
          className="btn"
          disabled={!fullSpan}
          onClick={() => dispatch({ type: 'set-range', range: null })}
        >
          Fit
        </button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'clear' })}>
          Clear
        </button>
      </div>

      <div className="spacer" />
      {loading ? (
        <div className="status">
          Parsing {loading.current}/{loading.total} · {loading.name}
        </div>
      ) : (
        <div className="keys">1 pan · 2 zoom · 3 measure · F fit · wheel zoom</div>
      )}
    </header>
  )
}
