import { useMemo, useState } from 'react'
import { fmtNum, fmtTime, integrateInterval, perSecondQuantity, sampleAt } from '../lib/math'
import { useTelemetry } from '../store'
import { DataConfig } from './DataConfig'
import { EngineAnalysis } from './EngineAnalysis'

export function Inspector() {
  const { measureCursors, plots, channelMap, timeMode, visibleRange, dispatch, views, showInfoEvents } =
    useTelemetry()
  const [viewName, setViewName] = useState('')
  const [tab, setTab] = useState<'inspect' | 'analysis' | 'config'>('inspect')
  const span = visibleRange ? visibleRange.t1 - visibleRange.t0 : 1
  const absolute = timeMode === 'absolute'
  const cursors = measureCursors.map((c) => c.t)

  const series = useMemo(() => {
    const out: {
      name: string
      unit: string
      color: string
      t: Float64Array
      y: Float64Array
      step: boolean
    }[] = []
    for (const plot of plots) {
      for (const s of plot.series) {
        if (!s.visible) continue
        const ch = channelMap.get(s.channelKey)
        if (!ch) continue
        out.push({
          name: ch.name,
          unit: ch.unit,
          color: s.color,
          t: timeMode === 'absolute' ? ch.tAbs : ch.tElapsed,
          y: ch.values,
          step: ch.step,
        })
      }
    }
    return out
  }, [plots, channelMap, timeMode])

  const segments = useMemo(() => {
    const segs: {
      from: number
      to: number
      a: number
      b: number
      dt: number
      rows: {
        name: string
        unit: string
        color: string
        y0: number
        y1: number
        dy: number
        slope: number
        integral: number | null
        integralUnit: string | null
      }[]
    }[] = []
    for (let i = 0; i < cursors.length - 1; i++) {
      const a = cursors[i]
      const b = cursors[i + 1]
      const dt = b - a
      segs.push({
        from: i,
        to: i + 1,
        a,
        b,
        dt,
        rows: series.map((s) => {
          const y0 = sampleAt(s.t, s.y, a, s.step)
          const y1 = sampleAt(s.t, s.y, b, s.step)
          const dy = y1 - y0
          const integralUnit = perSecondQuantity(s.unit)
          return {
            name: s.name,
            unit: s.unit,
            color: s.color,
            y0,
            y1,
            dy,
            slope: dt === 0 ? NaN : dy / dt,
            integral: integralUnit ? integrateInterval(s.t, s.y, a, b, s.step) : null,
            integralUnit,
          }
        }),
      })
    }
    return segs
  }, [cursors, series])

  const overall = useMemo(() => {
    if (cursors.length < 3) return null
    const a = cursors[0]
    const b = cursors[cursors.length - 1]
    return {
      a,
      b,
      dt: b - a,
      integrals: series.flatMap((s) => {
        const integralUnit = perSecondQuantity(s.unit)
        if (!integralUnit) return []
        return [{ name: s.name, color: s.color, integralUnit, integral: integrateInterval(s.t, s.y, a, b, s.step) }]
      }),
    }
  }, [cursors, series])

  return (
    <aside className="inspector">
      <nav className="inspector-tabs" aria-label="Inspector panels">
        <button type="button" className={tab === 'inspect' ? 'active' : ''} onClick={() => setTab('inspect')}>Inspect</button>
        <button type="button" className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}>Analysis</button>
        <button type="button" className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>Config</button>
      </nav>
      {tab === 'inspect' && <>
      <section>
        <div className="side-head">
          <div>
            <div className="kicker">Cursors</div>
            <h2>Measure</h2>
          </div>
          <button type="button" className="tiny" onClick={() => dispatch({ type: 'clear-measure' })}>
            Clear
          </button>
        </div>
        <p className="hint">
          Select Measure, then click the plot to drop cursors. Drag to move, right-click to remove.
          Each segment reports ΔX, ΔY, and slope for every visible channel. Channels in
          units of something/s also report the integral between the cursors.
        </p>
        {cursors.length === 0 ? (
          <div className="empty-lite">No cursors</div>
        ) : (
          <ol className="cursor-list">
            {measureCursors.map((cursor, i) => (
              <li key={cursor.id}>
                <span className="badge">{String.fromCharCode(65 + i)}</span>
                <span>{fmtTime(cursor.t, span, absolute)}</span>
                <button
                  type="button"
                  className="tiny"
                  onClick={() => dispatch({ type: 'remove-measure', id: cursor.id })}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        {segments.map((seg) => (
          <div key={`${seg.a}-${seg.b}`} className="segment">
            <div className="seg-head">
              {String.fromCharCode(65 + seg.from)} → {String.fromCharCode(65 + seg.to)}
              <span>ΔX {fmtTime(seg.dt, Math.max(seg.dt, span * 0.01), false).replace(/ s$/, ' s')}</span>
            </div>
            <div className="kv">
              <span>ΔX</span>
              <b>{fmtNum(seg.dt, 4)} s</b>
            </div>
            {seg.rows.map((row) => (
              <div key={row.name} className="measure-row">
                <div className="measure-name">
                  <span className="dot" style={{ background: row.color }} />
                  {row.name}
                </div>
                <div className="kv">
                  <span>ΔY</span>
                  <b>
                    {fmtNum(row.dy, 3)} {row.unit}
                  </b>
                </div>
                <div className="kv">
                  <span>Slope</span>
                  <b>
                    {fmtNum(row.slope, 3)} {row.unit ? `${row.unit}/s` : '/s'}
                  </b>
                </div>
                {row.integralUnit ? (
                  <div className="kv">
                    <span>∫</span>
                    <b>
                      {fmtNum(row.integral ?? NaN, 3)} {row.integralUnit}
                    </b>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
        {overall ? (
          <div className="segment overall">
            <div className="seg-head">
              A → {String.fromCharCode(64 + cursors.length)}
              <span>full span</span>
            </div>
            <div className="kv">
              <span>ΔX</span>
              <b>{fmtNum(overall.dt, 4)} s</b>
            </div>
            {overall.integrals.map((row) => (
              <div key={row.name} className="kv">
                <span style={{ color: row.color }}>∫ {row.name}</span>
                <b>
                  {fmtNum(row.integral, 3)} {row.integralUnit}
                </b>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <div className="side-head">
          <div>
            <div className="kicker">Time windows</div>
            <h2>Views</h2>
          </div>
        </div>
        <p className="hint">Save the current zoom window and jump back to it later.</p>
        <form
          className="view-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!visibleRange) return
            const name =
              viewName.trim() ||
              `${fmtTime(visibleRange.t0, span, absolute)} – ${fmtTime(visibleRange.t1, span, absolute)}`
            dispatch({ type: 'save-view', name, t0: visibleRange.t0, t1: visibleRange.t1 })
            setViewName('')
          }}
        >
          <input
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="Ignition, failure, ..."
          />
          <button type="submit" className="btn" disabled={!visibleRange}>
            Save view
          </button>
        </form>
        <div className="view-list">
          {views.length === 0 ? (
            <div className="empty-lite">No saved views</div>
          ) : (
            views.map((v) => (
              <div key={v.id} className="view-item">
                <button
                  type="button"
                  className="view-go"
                  onClick={() => {
                    dispatch({ type: 'set-time-mode', timeMode: v.timeMode })
                    dispatch({ type: 'set-range', range: { t0: v.t0, t1: v.t1 } })
                  }}
                >
                  <span>{v.name}</span>
                  <span className="meta">
                    {fmtTime(v.t0, v.t1 - v.t0, v.timeMode === 'absolute')} →{' '}
                    {fmtTime(v.t1, v.t1 - v.t0, v.timeMode === 'absolute')}
                  </span>
                </button>
                <button
                  type="button"
                  className="tiny"
                  onClick={() => dispatch({ type: 'delete-view', id: v.id })}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="flags">
        <label>
          <input
            type="checkbox"
            checked={showInfoEvents}
            onChange={() => dispatch({ type: 'toggle-info-events' })}
          />
          Show info events
        </label>
      </section>
      </>}
      {tab === 'analysis' && <EngineAnalysis onConfigure={() => setTab('config')} />}
      {tab === 'config' && <DataConfig onAnalyze={() => setTab('analysis')} />}
    </aside>
  )
}
