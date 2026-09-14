export type TimeMode = 'elapsed' | 'absolute'
export type Tool = 'pan' | 'zoom' | 'measure'
export type AxisSide = 'left' | 'right'

export type TelemetryEvent = {
  tElapsed: number
  tAbs: number
  label: string
  priority: 'info' | 'event'
}

export type Channel = {
  key: string
  fileId: string
  name: string
  unit: string
  group: string
  step: boolean
  values: Float64Array
}

export type TelemetryFile = {
  id: string
  name: string
  folder: string
  rowCount: number
  tElapsed: Float64Array
  tAbs: Float64Array
  hasAbsolute: boolean
  channels: Channel[]
  events: TelemetryEvent[]
}

export type PlotSeries = {
  key: string
  channelKey: string
  color: string
  axisId: string
  visible: boolean
}

export type PlotAxis = {
  id: string
  unit: string
  side: AxisSide
}

export type Plot = {
  id: string
  series: PlotSeries[]
  axes: PlotAxis[]
}

export type SavedView = {
  id: string
  name: string
  t0: number
  t1: number
  timeMode: TimeMode
}

export type TimeRange = {
  t0: number
  t1: number
}
