export type ChartTool = 'pan' | 'zoom' | 'measure'

export type ChartSeries = {
  key: string
  name: string
  unit: string
  color: string
  t: Float64Array
  y: Float64Array
  step: boolean
  axisId: string
  visible: boolean
}

export type ChartEvent = {
  t: number
  label: string
  priority: 'info' | 'event'
}
