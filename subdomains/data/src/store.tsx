import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import { colorFor, uid } from './lib/math'
import type {
  Plot,
  PlotAxis,
  PlotSeries,
  SavedView,
  TelemetryFile,
  TimeMode,
  TimeRange,
  Tool,
} from './types'

const VIEWS_KEY = 'datanator.views'

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedView[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistViews(views: SavedView[]) {
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views))
  } catch {
    /* ignore quota */
  }
}

type State = {
  files: TelemetryFile[]
  plots: Plot[]
  activePlotId: string | null
  tool: Tool
  timeMode: TimeMode
  range: TimeRange | null
  measureTimes: number[]
  views: SavedView[]
  loading: { current: number; total: number; name: string } | null
  error: string | null
  showInfoEvents: boolean
}

type Action =
  | { type: 'add-files'; files: TelemetryFile[] }
  | { type: 'remove-file'; fileId: string }
  | { type: 'clear' }
  | { type: 'set-loading'; loading: State['loading'] }
  | { type: 'set-error'; error: string | null }
  | { type: 'set-tool'; tool: Tool }
  | { type: 'set-time-mode'; timeMode: TimeMode }
  | { type: 'set-range'; range: TimeRange | null }
  | { type: 'add-plot' }
  | { type: 'remove-plot'; plotId: string }
  | { type: 'set-active-plot'; plotId: string }
  | { type: 'toggle-channel'; channelKey: string; plotId?: string }
  | { type: 'add-channel'; channelKey: string; plotId: string }
  | { type: 'remove-series'; plotId: string; seriesKey: string }
  | { type: 'toggle-series-visible'; plotId: string; seriesKey: string }
  | { type: 'split-axis'; plotId: string; seriesKey: string }
  | { type: 'merge-axis'; plotId: string; seriesKey: string }
  | { type: 'set-measure'; times: number[] }
  | { type: 'add-measure'; t: number }
  | { type: 'move-measure'; index: number; t: number }
  | { type: 'remove-measure'; index: number }
  | { type: 'clear-measure' }
  | { type: 'save-view'; name: string; t0: number; t1: number }
  | { type: 'delete-view'; id: string }
  | { type: 'toggle-info-events' }

function axisForUnit(plot: Plot, unit: string): PlotAxis {
  const existing = plot.axes.find((a) => a.unit === unit)
  if (existing) return existing
  const lefts = plot.axes.filter((a) => a.side === 'left').length
  const rights = plot.axes.filter((a) => a.side === 'right').length
  const side = lefts <= rights ? 'left' : 'right'
  return { id: uid('axis'), unit, side }
}

function withAxis(plot: Plot, axis: PlotAxis): Plot {
  if (plot.axes.some((a) => a.id === axis.id)) return plot
  return { ...plot, axes: [...plot.axes, axis] }
}

function pruneAxes(plot: Plot): Plot {
  const used = new Set(plot.series.map((s) => s.axisId))
  return { ...plot, axes: plot.axes.filter((a) => used.has(a.id)) }
}

function findChannel(files: TelemetryFile[], channelKey: string) {
  for (const file of files) {
    const ch = file.channels.find((c) => c.key === channelKey)
    if (ch) return { file, channel: ch }
  }
  return null
}

function addChannelToPlot(state: State, plotId: string, channelKey: string): State {
  const found = findChannel(state.files, channelKey)
  if (!found) return state
  const plots = state.plots.map((plot) => {
    if (plot.id !== plotId) return plot
    if (plot.series.some((s) => s.channelKey === channelKey)) return plot
    const axis = axisForUnit(plot, found.channel.unit)
    const series: PlotSeries = {
      key: uid('ser'),
      channelKey,
      color: colorFor(channelKey),
      axisId: axis.id,
      visible: true,
    }
    return pruneAxes(withAxis({ ...plot, series: [...plot.series, series] }, axis))
  })
  return { ...state, plots, activePlotId: plotId }
}

function ensurePlot(state: State): { state: State; plotId: string } {
  if (state.activePlotId && state.plots.some((p) => p.id === state.activePlotId)) {
    return { state, plotId: state.activePlotId }
  }
  if (state.plots[0]) return { state: { ...state, activePlotId: state.plots[0].id }, plotId: state.plots[0].id }
  const plot: Plot = { id: uid('plot'), series: [], axes: [] }
  return {
    state: { ...state, plots: [plot], activePlotId: plot.id },
    plotId: plot.id,
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add-files': {
      const files = [...state.files]
      for (const f of action.files) {
        if (!files.some((x) => x.id === f.id)) files.push(f)
      }
      return { ...state, files, error: null }
    }
    case 'remove-file': {
      const files = state.files.filter((f) => f.id !== action.fileId)
      const plots = state.plots
        .map((plot) =>
          pruneAxes({
            ...plot,
            series: plot.series.filter((s) => !s.channelKey.startsWith(`${action.fileId}::`)),
          }),
        )
      return { ...state, files, plots }
    }
    case 'clear':
      return {
        ...state,
        files: [],
        plots: [],
        activePlotId: null,
        range: null,
        measureTimes: [],
        error: null,
      }
    case 'set-loading':
      return { ...state, loading: action.loading }
    case 'set-error':
      return { ...state, error: action.error }
    case 'set-tool':
      return { ...state, tool: action.tool }
    case 'set-time-mode':
      return { ...state, timeMode: action.timeMode, range: null }
    case 'set-range':
      return { ...state, range: action.range }
    case 'add-plot': {
      const plot: Plot = { id: uid('plot'), series: [], axes: [] }
      return { ...state, plots: [...state.plots, plot], activePlotId: plot.id }
    }
    case 'remove-plot': {
      const plots = state.plots.filter((p) => p.id !== action.plotId)
      const activePlotId =
        state.activePlotId === action.plotId ? (plots[0]?.id ?? null) : state.activePlotId
      return { ...state, plots, activePlotId }
    }
    case 'set-active-plot':
      return { ...state, activePlotId: action.plotId }
    case 'toggle-channel': {
      const targetId = action.plotId ?? state.activePlotId
      const prepared = ensurePlot(targetId ? { ...state, activePlotId: targetId } : state)
      const plot = prepared.state.plots.find((p) => p.id === prepared.plotId)
      if (plot?.series.some((s) => s.channelKey === action.channelKey)) {
        const plots = prepared.state.plots.map((p) =>
          p.id === prepared.plotId
            ? pruneAxes({
                ...p,
                series: p.series.filter((s) => s.channelKey !== action.channelKey),
              })
            : p,
        )
        return { ...prepared.state, plots }
      }
      return addChannelToPlot(prepared.state, prepared.plotId, action.channelKey)
    }
    case 'add-channel': {
      const prepared = state.plots.some((p) => p.id === action.plotId)
        ? { state, plotId: action.plotId }
        : ensurePlot(state)
      return addChannelToPlot(prepared.state, prepared.plotId, action.channelKey)
    }
    case 'remove-series': {
      const plots = state.plots.map((p) =>
        p.id === action.plotId
          ? pruneAxes({ ...p, series: p.series.filter((s) => s.key !== action.seriesKey) })
          : p,
      )
      return { ...state, plots }
    }
    case 'toggle-series-visible': {
      const plots = state.plots.map((p) =>
        p.id === action.plotId
          ? {
              ...p,
              series: p.series.map((s) =>
                s.key === action.seriesKey ? { ...s, visible: !s.visible } : s,
              ),
            }
          : p,
      )
      return { ...state, plots }
    }
    case 'split-axis': {
      const plots = state.plots.map((plot) => {
        if (plot.id !== action.plotId) return plot
        const series = plot.series.find((s) => s.key === action.seriesKey)
        if (!series) return plot
        const onAxis = plot.series.filter((s) => s.axisId === series.axisId)
        if (onAxis.length <= 1) return plot
        const found = findChannel(state.files, series.channelKey)
        const lefts = plot.axes.filter((a) => a.side === 'left').length
        const rights = plot.axes.filter((a) => a.side === 'right').length
        const axis: PlotAxis = {
          id: uid('axis'),
          unit: found?.channel.unit ?? '',
          side: lefts <= rights ? 'left' : 'right',
        }
        return pruneAxes({
          ...plot,
          axes: [...plot.axes, axis],
          series: plot.series.map((s) => (s.key === series.key ? { ...s, axisId: axis.id } : s)),
        })
      })
      return { ...state, plots }
    }
    case 'merge-axis': {
      const plots = state.plots.map((plot) => {
        if (plot.id !== action.plotId) return plot
        const series = plot.series.find((s) => s.key === action.seriesKey)
        if (!series) return plot
        const found = findChannel(state.files, series.channelKey)
        const unit = found?.channel.unit ?? ''
        const axis = plot.axes.find((a) => a.unit === unit && a.id !== series.axisId) ?? axisForUnit(plot, unit)
        return pruneAxes(
          withAxis(
            {
              ...plot,
              series: plot.series.map((s) => (s.key === series.key ? { ...s, axisId: axis.id } : s)),
            },
            axis,
          ),
        )
      })
      return { ...state, plots }
    }
    case 'set-measure':
      return { ...state, measureTimes: [...action.times].sort((a, b) => a - b) }
    case 'add-measure': {
      if (state.measureTimes.some((t) => Math.abs(t - action.t) < 1e-9)) return state
      return { ...state, measureTimes: [...state.measureTimes, action.t].sort((a, b) => a - b) }
    }
    case 'move-measure': {
      const next = state.measureTimes.slice()
      next[action.index] = action.t
      return { ...state, measureTimes: next }
    }
    case 'remove-measure':
      return {
        ...state,
        measureTimes: state.measureTimes.filter((_, i) => i !== action.index),
      }
    case 'clear-measure':
      return { ...state, measureTimes: [] }
    case 'save-view': {
      const view: SavedView = {
        id: uid('view'),
        name: action.name,
        t0: action.t0,
        t1: action.t1,
        timeMode: state.timeMode,
      }
      const views = [...state.views, view]
      persistViews(views)
      return { ...state, views }
    }
    case 'delete-view': {
      const views = state.views.filter((v) => v.id !== action.id)
      persistViews(views)
      return { ...state, views }
    }
    case 'toggle-info-events':
      return { ...state, showInfoEvents: !state.showInfoEvents }
    default:
      return state
  }
}

const initial: State = {
  files: [],
  plots: [],
  activePlotId: null,
  tool: 'pan',
  timeMode: 'elapsed',
  range: null,
  measureTimes: [],
  views: loadViews(),
  loading: null,
  error: null,
  showInfoEvents: false,
}

type TelemetryContextValue = State & {
  dispatch: Dispatch<Action>
  fullSpan: TimeRange | null
  visibleRange: TimeRange | null
  hasAbsolute: boolean
  channelMap: Map<string, { file: TelemetryFile; name: string; unit: string; group: string; step: boolean; values: Float64Array; tElapsed: Float64Array; tAbs: Float64Array }>
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null)

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial)

  const hasAbsolute = state.files.length > 0 && state.files.every((f) => f.hasAbsolute)

  const fullSpan = useMemo(() => {
    if (state.files.length === 0) return null
    const plottedKeys = new Set(state.plots.flatMap((p) => p.series.map((s) => s.channelKey)))
    const sources = plottedKeys.size
      ? state.files.flatMap((file) => {
          const used = file.channels.some((c) => plottedKeys.has(c.key))
          return used ? [file] : []
        })
      : state.files
    let t0 = Infinity
    let t1 = -Infinity
    for (const file of sources) {
      const t = state.timeMode === 'absolute' && file.hasAbsolute ? file.tAbs : file.tElapsed
      if (t.length === 0) continue
      if (t[0] < t0) t0 = t[0]
      if (t[t.length - 1] > t1) t1 = t[t.length - 1]
    }
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null
    return { t0, t1 }
  }, [state.files, state.plots, state.timeMode])

  const visibleRange = useMemo(() => {
    if (!fullSpan) return null
    if (!state.range) return fullSpan
    const t0 = Math.max(state.range.t0, fullSpan.t0)
    const t1 = Math.min(state.range.t1, fullSpan.t1)
    if (t1 <= t0) return fullSpan
    return { t0, t1 }
  }, [fullSpan, state.range])

  const channelMap = useMemo(() => {
    const map: TelemetryContextValue['channelMap'] = new Map()
    for (const file of state.files) {
      for (const ch of file.channels) {
        map.set(ch.key, {
          file,
          name: ch.name,
          unit: ch.unit,
          group: ch.group,
          step: ch.step,
          values: ch.values,
          tElapsed: file.tElapsed,
          tAbs: file.tAbs,
        })
      }
    }
    return map
  }, [state.files])

  const value = useMemo<TelemetryContextValue>(
    () => ({ ...state, dispatch, fullSpan, visibleRange, hasAbsolute, channelMap }),
    [state, fullSpan, visibleRange, hasAbsolute, channelMap],
  )

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useTelemetry outside provider')
  return ctx
}

export function useLoadFiles() {
  const { dispatch } = useTelemetry()

  return useCallback(
    async (items: { id?: string; name: string; folder: string; buffer: ArrayBuffer }[]) => {
      if (items.length === 0) return
      dispatch({ type: 'set-error', error: null })
      const worker = new Worker(new URL('./parseWorker.ts', import.meta.url), { type: 'module' })
      try {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          dispatch({
            type: 'set-loading',
            loading: { current: i + 1, total: items.length, name: item.name },
          })
          const file = await new Promise<TelemetryFile>((resolve, reject) => {
            const onMsg = (e: MessageEvent) => {
              worker.removeEventListener('message', onMsg)
              if (e.data?.ok) resolve(e.data.file as TelemetryFile)
              else reject(new Error(e.data?.error ?? `Failed to parse ${item.name}`))
            }
            worker.addEventListener('message', onMsg)
            worker.postMessage({
              id: item.id ?? uid('file'),
              name: item.name,
              folder: item.folder,
              buffer: item.buffer,
            })
          })
          dispatch({ type: 'add-files', files: [file] })
        }
      } catch (err) {
        dispatch({ type: 'set-error', error: err instanceof Error ? err.message : String(err) })
      } finally {
        worker.terminate()
        dispatch({ type: 'set-loading', loading: null })
      }
    },
    [dispatch],
  )
}
