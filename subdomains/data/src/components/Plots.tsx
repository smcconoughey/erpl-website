import { useTelemetry } from '../store'
import { ChartCanvas } from './ChartCanvas'
import type { ChartEvent, ChartSeries } from './chartTypes'

export function Plots() {
  const {
    plots,
    activePlotId,
    files,
    channelMap,
    timeMode,
    visibleRange,
    fullSpan,
    tool,
    measureTimes,
    showInfoEvents,
    dispatch,
  } = useTelemetry()

  if (!visibleRange || !fullSpan) {
    return <div className="plots empty-lite">Load CSV files, then click channels to plot.</div>
  }

  const events: ChartEvent[] = (() => {
    const used = new Set<string>()
    for (const plot of plots) {
      for (const s of plot.series) {
        const ch = channelMap.get(s.channelKey)
        if (ch) used.add(ch.file.id)
      }
    }
    return files
      .filter((file) => used.has(file.id))
      .flatMap((file) =>
        file.events
          .filter((e) => showInfoEvents || e.priority === 'event')
          .map((e) => ({
            t: timeMode === 'absolute' ? e.tAbs : e.tElapsed,
            label: e.label,
            priority: e.priority,
          })),
      )
  })()

  if (plots.length === 0) {
    return (
      <div
        className="plots drop-plot"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const key = e.dataTransfer.getData('text/channel-key')
          if (key) dispatch({ type: 'toggle-channel', channelKey: key })
        }}
      >
        <div className="empty-lite">Click a channel or drop it here to create a plot.</div>
      </div>
    )
  }

  return (
    <div className="plots">
      {plots.map((plot) => {
        const series: ChartSeries[] = plot.series.flatMap((s) => {
          const ch = channelMap.get(s.channelKey)
          if (!ch) return []
          const filesOnPlot = new Set(
            plot.series.map((x) => channelMap.get(x.channelKey)?.file.id).filter(Boolean),
          )
          const fileLabel = ch.file.name.replace(/\.csv$/i, '')
          return [
            {
              key: s.key,
              name: filesOnPlot.size > 1 ? `${fileLabel} / ${ch.name}` : ch.name,
              unit: ch.unit,
              color: s.color,
              t: timeMode === 'absolute' ? ch.tAbs : ch.tElapsed,
              y: ch.values,
              step: ch.step,
              axisId: s.axisId,
              visible: s.visible,
            },
          ]
        })
        return (
          <section
            key={plot.id}
            className={`plot-pane${activePlotId === plot.id ? ' active' : ''}`}
            onMouseDown={() => dispatch({ type: 'set-active-plot', plotId: plot.id })}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              e.preventDefault()
              const key = e.dataTransfer.getData('text/channel-key')
              if (key) dispatch({ type: 'add-channel', channelKey: key, plotId: plot.id })
            }}
          >
            <header className="plot-legend">
              <div className="legend-chips">
                {plot.series.length === 0 ? (
                  <span className="empty-lite">Drop channels onto this plot</span>
                ) : (
                  plot.series.map((s) => {
                    const ch = channelMap.get(s.channelKey)
                    const axis = plot.axes.find((a) => a.id === s.axisId)
                    const sameUnit = plot.series.filter((x) => {
                      const other = channelMap.get(x.channelKey)
                      return other?.unit === ch?.unit
                    }).length
                    return (
                      <span key={s.key} className={`chip${s.visible ? '' : ' dim'}`}>
                        <button
                          type="button"
                          className="chip-main"
                          onClick={() =>
                            dispatch({ type: 'toggle-series-visible', plotId: plot.id, seriesKey: s.key })
                          }
                        >
                          <span className="dot" style={{ background: s.color }} />
                      {ch
                        ? new Set(plot.series.map((x) => channelMap.get(x.channelKey)?.file.id).filter(Boolean)).size > 1
                          ? `${ch.file.name.replace(/\.csv$/i, '')} / ${ch.name}`
                          : ch.name
                        : s.channelKey}
                          {axis?.unit ? <em>{axis.unit}</em> : null}
                        </button>
                        {sameUnit > 1 ? (
                          <button
                            type="button"
                            className="tiny"
                            title="Own axis"
                            onClick={() => dispatch({ type: 'split-axis', plotId: plot.id, seriesKey: s.key })}
                          >
                            ⧉
                          </button>
                        ) : plot.axes.filter((a) => a.unit === ch?.unit).length > 1 ? (
                          <button
                            type="button"
                            className="tiny"
                            title="Merge axis"
                            onClick={() => dispatch({ type: 'merge-axis', plotId: plot.id, seriesKey: s.key })}
                          >
                            ⧉
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="tiny"
                          onClick={() => dispatch({ type: 'remove-series', plotId: plot.id, seriesKey: s.key })}
                        >
                          ×
                        </button>
                      </span>
                    )
                  })
                )}
              </div>
              <button
                type="button"
                className="tiny"
                title="Remove plot"
                onClick={() => dispatch({ type: 'remove-plot', plotId: plot.id })}
              >
                ×
              </button>
            </header>
            <ChartCanvas
              series={series}
              axes={plot.axes}
              events={events}
              t0={visibleRange.t0}
              t1={visibleRange.t1}
              fullT0={fullSpan.t0}
              fullT1={fullSpan.t1}
              absolute={timeMode === 'absolute'}
              tool={tool}
              measureTimes={measureTimes}
              active={activePlotId === plot.id}
              onPan={(t0, t1) => dispatch({ type: 'set-range', range: { t0, t1 } })}
              onZoom={(t0, t1) => dispatch({ type: 'set-range', range: { t0, t1 } })}
              onMeasureAdd={(t) => dispatch({ type: 'add-measure', t })}
              onMeasureMove={(index, t) => dispatch({ type: 'move-measure', index, t })}
              onMeasureRemove={(index) => dispatch({ type: 'remove-measure', index })}
              onActivate={() => dispatch({ type: 'set-active-plot', plotId: plot.id })}
            />
          </section>
        )
      })}
    </div>
  )
}
