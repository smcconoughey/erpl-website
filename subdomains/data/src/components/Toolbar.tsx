import { useTelemetry } from '../store'

type Props = {
  campaignCount: number | null
  onOpenFolder: () => void
  onOpenFiles: () => void
  onLoadCampaign: () => void
}

export function Toolbar({ campaignCount, onOpenFolder, onOpenFiles, onLoadCampaign }: Props) {
  const { tool, timeMode, hasAbsolute, loading, fullSpan, dispatch } = useTelemetry()

  return (
    <header className="toolbar">
      <div className="brand">
        <div className="mark" />
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
        {campaignCount ? (
          <button type="button" className="btn accent" onClick={() => void onLoadCampaign()}>
            Load this folder
          </button>
        ) : null}
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
