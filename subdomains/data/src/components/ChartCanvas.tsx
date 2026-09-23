import { useEffect, useRef } from 'react'
import {
  fmtNum,
  fmtTime,
  minMaxBuckets,
  nearestIndex,
  niceTicks,
  padRange,
  integrateInterval,
  perSecondQuantity,
  sampleAt,
  visibleBounds,
  windowRange,
} from '../lib/math'
import type { ChartEvent, ChartSeries, ChartTool } from './chartTypes'
import type { MeasureCursor } from '../types'

type AxisDef = {
  id: string
  unit: string
  side: 'left' | 'right'
}

type Props = {
  series: ChartSeries[]
  axes: AxisDef[]
  events: ChartEvent[]
  t0: number
  t1: number
  fullT0: number
  fullT1: number
  absolute: boolean
  tool: ChartTool
  measureCursors: MeasureCursor[]
  active?: boolean
  onPan: (t0: number, t1: number) => void
  onZoom: (t0: number, t1: number) => void
  onMeasureAdd: (t: number) => void
  onMeasureMove: (id: string, t: number) => void
  onMeasureRemove: (id: string) => void
  onActivate?: () => void
}

const AXIS_W = 62
const BOTTOM = 26
const TOP = 10
const GAP = 8
const HOVER_HIT_PX = 14
const HOVER_FALLBACK_PX = 38

type AxisLayout = {
  id: string
  unit: string
  side: 'left' | 'right'
  spineX: number
  min: number
  max: number
  toY: (v: number) => number
  color: string
}

function nearestHoverKeys(
  sers: ChartSeries[],
  axisLayouts: AxisLayout[],
  hoverT: number,
  pointerY: number,
): Set<string> {
  const hits: { key: string; d: number }[] = []
  for (const s of sers) {
    if (!s.visible) continue
    const axis = axisLayouts.find((a) => a.id === s.axisId)
    if (!axis) continue
    const yv = sampleAt(s.t, s.y, hoverT, s.step)
    if (!Number.isFinite(yv)) continue
    hits.push({ key: s.key, d: Math.abs(axis.toY(yv) - pointerY) })
  }
  if (hits.length === 0) return new Set()
  const close = hits.filter((h) => h.d <= HOVER_HIT_PX)
  if (close.length > 0) return new Set(close.map((h) => h.key))
  let best = hits[0]
  for (const h of hits) {
    if (h.d < best.d) best = h
  }
  return best.d <= HOVER_FALLBACK_PX ? new Set([best.key]) : new Set()
}

function clampRange(t0: number, t1: number, fullT0: number, fullT1: number): { t0: number; t1: number } {
  const full = fullT1 - fullT0
  const minSpan = Math.max(full * 1e-5, 1e-3)
  let a = t0
  let b = t1
  if (b - a < minSpan) {
    const mid = (a + b) / 2
    a = mid - minSpan / 2
    b = mid + minSpan / 2
  }
  if (a < fullT0) {
    b += fullT0 - a
    a = fullT0
  }
  if (b > fullT1) {
    a -= b - fullT1
    b = fullT1
  }
  if (a < fullT0) a = fullT0
  if (b > fullT1) b = fullT1
  if (b - a < minSpan) return { t0: fullT0, t1: fullT1 }
  return { t0: a, t1: b }
}

export function ChartCanvas({
  series,
  axes,
  events,
  t0,
  t1,
  fullT0,
  fullT1,
  absolute,
  tool,
  measureCursors,
  active,
  onPan,
  onZoom,
  onMeasureAdd,
  onMeasureMove,
  onMeasureRemove,
  onActivate,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<HTMLDivElement>(null)
  const drawRef = useRef<() => void>(() => {})
  const layoutRef = useRef<{
    plot: { x: number; y: number; w: number; h: number }
    axes: AxisLayout[]
    cssW: number
    cssH: number
  } | null>(null)

  const seriesRef = useRef(series)
  seriesRef.current = series
  const axesRef = useRef(axes)
  axesRef.current = axes
  const eventsRef = useRef(events)
  eventsRef.current = events
  const rangeRef = useRef({ t0, t1, fullT0, fullT1, absolute, tool, measureCursors, active: Boolean(active) })
  rangeRef.current = { t0, t1, fullT0, fullT1, absolute, tool, measureCursors, active: Boolean(active) }

  const panRef = useRef<{ x: number; t0: number; t1: number } | null>(null)
  const zoomRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const dragMeasureRef = useRef<string | null>(null)
  const hoverTRef = useRef<number | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const cssW = wrap.clientWidth
      const cssH = wrap.clientHeight
      if (cssW < 40 || cssH < 40) return
      const dpr = window.devicePixelRatio || 1
      const pxW = Math.floor(cssW * dpr)
      const pxH = Math.floor(cssH * dpr)
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW
        canvas.height = pxH
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const { t0: rt0, t1: rt1, absolute: abs, measureCursors: cursors, tool: currentTool } = rangeRef.current
      const sers = seriesRef.current
      const axisDefs = axesRef.current
      const evs = eventsRef.current

      const leftAxes = axisDefs.filter((a) => a.side === 'left')
      const rightAxes = axisDefs.filter((a) => a.side === 'right')
      const leftPad = GAP + Math.max(leftAxes.length, 1) * AXIS_W
      const rightPad = GAP + Math.max(rightAxes.length, 0) * AXIS_W + (rightAxes.length === 0 ? 8 : 0)
      const plot = { x: leftPad, y: TOP, w: Math.max(40, cssW - leftPad - rightPad), h: Math.max(40, cssH - TOP - BOTTOM) }

      const span = Math.max(rt1 - rt0, 1e-9)
      const toX = (t: number) => plot.x + ((t - rt0) / span) * plot.w

      const axisLayouts: AxisLayout[] = []
      const buildAxis = (def: AxisDef, slot: number, side: 'left' | 'right') => {
        const members = sers.filter((s) => s.axisId === def.id && s.visible)
        let min = Infinity
        let max = -Infinity
        let anyStep = true
        for (const s of members) {
          const r = windowRange(s.t, s.y, rt0, rt1)
          if (!r) continue
          min = Math.min(min, r.min)
          max = Math.max(max, r.max)
          if (!s.step) anyStep = false
        }
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          min = 0
          max = 1
        }
        const padded = padRange(min, max, anyStep && members.length > 0)
        const ySpan = padded.max - padded.min || 1
        const toY = (v: number) => plot.y + plot.h - ((v - padded.min) / ySpan) * plot.h
        const spineX = side === 'left' ? plot.x - slot * AXIS_W : plot.x + plot.w + slot * AXIS_W
        axisLayouts.push({
          id: def.id,
          unit: def.unit,
          side,
          spineX,
          min: padded.min,
          max: padded.max,
          toY,
          color: members[0]?.color ?? '#8b95a5',
        })
      }
      leftAxes.forEach((a, i) => buildAxis(a, i, 'left'))
      rightAxes.forEach((a, i) => buildAxis(a, i, 'right'))

      layoutRef.current = { plot, axes: axisLayouts, cssW, cssH }

      ctx.fillStyle = rangeRef.current.active ? '#141821' : '#10131a'
      ctx.fillRect(0, 0, cssW, cssH)

      ctx.save()
      ctx.beginPath()
      ctx.rect(plot.x, plot.y, plot.w, plot.h)
      ctx.clip()

      const xTicks = niceTicks(rt0, rt1, Math.max(4, Math.floor(plot.w / 110)))
      ctx.strokeStyle = '#1c222c'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const tick of xTicks) {
        const x = toX(tick)
        ctx.moveTo(x, plot.y)
        ctx.lineTo(x, plot.y + plot.h)
      }
      const primary = axisLayouts[0]
      if (primary) {
        const yTicks = niceTicks(primary.min, primary.max, Math.max(3, Math.floor(plot.h / 48)))
        for (const tick of yTicks) {
          const y = primary.toY(tick)
          ctx.moveTo(plot.x, y)
          ctx.lineTo(plot.x + plot.w, y)
        }
      }
      ctx.stroke()

      const inView = evs.filter((ev) => ev.t >= rt0 && ev.t <= rt1)
      const stepEv = inView.length > 40 ? Math.ceil(inView.length / 40) : 1
      let labelCount = 0
      for (let i = 0; i < inView.length; i += stepEv) {
        const ev = inView[i]
        const x = toX(ev.t)
        ctx.strokeStyle = ev.priority === 'event' ? 'rgba(240,193,75,0.4)' : 'rgba(139,149,165,0.18)'
        ctx.setLineDash(ev.priority === 'event' ? [4, 3] : [2, 4])
        ctx.beginPath()
        ctx.moveTo(x, plot.y)
        ctx.lineTo(x, plot.y + plot.h)
        ctx.stroke()
        ctx.setLineDash([])
        if (ev.priority === 'event' && labelCount < 10) {
          ctx.fillStyle = 'rgba(240,193,75,0.85)'
          ctx.font = '10px ui-monospace, Consolas, monospace'
          const label = ev.label.length > 36 ? `${ev.label.slice(0, 34)}…` : ev.label
          ctx.fillText(label, x + 4, plot.y + 12 + labelCount * 12)
          labelCount += 1
        }
      }

      const hoverT = hoverTRef.current
      const ptr = pointerRef.current
      const hoverKeys =
        hoverT != null && ptr ? nearestHoverKeys(sers, axisLayouts, hoverT, ptr.y) : new Set<string>()
      const focusing = hoverKeys.size > 0
      const drawOrder = sers.filter((s) => s.visible)
      if (focusing) {
        drawOrder.sort((a, b) => Number(hoverKeys.has(a.key)) - Number(hoverKeys.has(b.key)))
      }

      const buckets = Math.max(32, Math.floor(plot.w))
      for (const s of drawOrder) {
        const axis = axisLayouts.find((a) => a.id === s.axisId)
        if (!axis) continue
        const { i0, i1 } = visibleBounds(s.t, rt0, rt1)
        const isHot = hoverKeys.has(s.key)
        ctx.strokeStyle = s.color
        ctx.fillStyle = s.color
        ctx.globalAlpha = !focusing ? 0.95 : isHot ? 1 : 0.22
        ctx.lineWidth = (s.step ? 1.6 : 1.35) * (focusing && isHot ? 1.5 : 1)
        ctx.beginPath()
        if (i1 - i0 <= buckets) {
          let moved = false
          let lastY = 0
          for (let i = i0; i < i1; i++) {
            const v = s.y[i]
            if (!Number.isFinite(v)) {
              moved = false
              continue
            }
            const x = toX(s.t[i])
            const py = axis.toY(v)
            if (!moved) {
              ctx.moveTo(x, py)
              moved = true
            } else if (s.step) {
              ctx.lineTo(x, lastY)
              ctx.lineTo(x, py)
            } else {
              ctx.lineTo(x, py)
            }
            lastY = py
          }
          ctx.stroke()
          if (i1 - i0 <= 120) {
            for (let i = i0; i < i1; i++) {
              const v = s.y[i]
              if (!Number.isFinite(v)) continue
              ctx.beginPath()
              ctx.arc(toX(s.t[i]), axis.toY(v), 2.2, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        } else {
          const { mins, maxs, counts } = minMaxBuckets(s.t, s.y, rt0, rt1, buckets)
          let started = false
          let flip = false
          for (let i = 0; i < buckets; i++) {
            if (counts[i] === 0) continue
            const x = plot.x + ((i + 0.5) / buckets) * plot.w
            const ya = axis.toY(mins[i])
            const yb = axis.toY(maxs[i])
            if (!started) {
              ctx.moveTo(x, flip ? ya : yb)
              started = true
            }
            if (flip) {
              ctx.lineTo(x, ya)
              ctx.lineTo(x, yb)
            } else {
              ctx.lineTo(x, yb)
              ctx.lineTo(x, ya)
            }
            flip = !flip
          }
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }

      if (cursors.length > 0) {
        ctx.font = '10px ui-monospace, Consolas, monospace'
        cursors.forEach((cursor, i) => {
          const x = toX(cursor.t)
          ctx.strokeStyle = 'rgba(240,193,75,0.9)'
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.moveTo(x, plot.y)
          ctx.lineTo(x, plot.y + plot.h)
          ctx.stroke()
          ctx.fillStyle = '#f0c14b'
          ctx.fillRect(x - 3, plot.y, 6, 6)
          ctx.fillText(String.fromCharCode(65 + i), x + 5, plot.y + 10)
        })

        for (let i = 0; i < cursors.length - 1; i++) {
          const ta = cursors[i].t
          const tb = cursors[i + 1].t
          for (const s of sers) {
            if (!s.visible) continue
            const axis = axisLayouts.find((a) => a.id === s.axisId)
            if (!axis) continue
            const ya = sampleAt(s.t, s.y, ta, s.step)
            const yb = sampleAt(s.t, s.y, tb, s.step)
            if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue
            const isHot = hoverKeys.has(s.key)
            ctx.strokeStyle = s.color
            ctx.globalAlpha = !focusing ? 0.7 : isHot ? 0.9 : 0.18
            ctx.setLineDash([5, 4])
            ctx.beginPath()
            ctx.moveTo(toX(ta), axis.toY(ya))
            ctx.lineTo(toX(tb), axis.toY(yb))
            ctx.stroke()
            ctx.setLineDash([])
            ctx.globalAlpha = !focusing ? 1 : isHot ? 1 : 0.22
            const dt = tb - ta
            const slope = dt === 0 ? NaN : (yb - ya) / dt
            const mx = (toX(ta) + toX(tb)) / 2
            const my = (axis.toY(ya) + axis.toY(yb)) / 2
            const quantity = perSecondQuantity(s.unit)
            ctx.fillStyle = s.color
            ctx.fillText(
              quantity
                ? `∫ ${fmtNum(integrateInterval(s.t, s.y, ta, tb, s.step), 2)} ${quantity}`
                : `${fmtNum(slope, 2)}${s.unit ? ` ${s.unit}/s` : '/s'}`,
              mx + 4,
              my - 4,
            )
            ctx.globalAlpha = 1
          }
        }
      }

      if (hoverT != null && ptr && ptr.x >= plot.x && ptr.x <= plot.x + plot.w) {
        const x = toX(hoverT)
        ctx.strokeStyle = 'rgba(230,234,240,0.28)'
        ctx.beginPath()
        ctx.moveTo(x, plot.y)
        ctx.lineTo(x, plot.y + plot.h)
        ctx.stroke()
        for (const s of drawOrder) {
          const axis = axisLayouts.find((a) => a.id === s.axisId)
          if (!axis) continue
          const yv = sampleAt(s.t, s.y, hoverT, s.step)
          if (!Number.isFinite(yv)) continue
          const isHot = hoverKeys.has(s.key)
          if (focusing && !isHot) continue
          const y = axis.toY(yv)
          if (isHot) {
            ctx.fillStyle = 'rgba(230,234,240,0.9)'
            ctx.beginPath()
            ctx.arc(x, y, 6, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillStyle = s.color
          ctx.beginPath()
          ctx.arc(x, y, isHot ? 4.2 : 3.2, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      const zoom = zoomRef.current
      if (zoom && currentTool === 'zoom') {
        const zx = Math.min(zoom.x0, zoom.x1)
        const zw = Math.abs(zoom.x1 - zoom.x0)
        ctx.fillStyle = 'rgba(77,163,255,0.12)'
        ctx.strokeStyle = 'rgba(77,163,255,0.7)'
        ctx.fillRect(zx, plot.y, zw, plot.h)
        ctx.strokeRect(zx, plot.y, zw, plot.h)
      }

      ctx.restore()

      ctx.strokeStyle = '#2a3340'
      ctx.strokeRect(plot.x, plot.y, plot.w, plot.h)

      ctx.font = '10px ui-monospace, Consolas, monospace'
      ctx.fillStyle = '#8b95a5'
      ctx.textBaseline = 'top'
      for (const tick of xTicks) {
        const x = toX(tick)
        ctx.fillText(fmtTime(tick, span, abs), x + 2, plot.y + plot.h + 6)
      }

      ctx.textBaseline = 'middle'
      for (const axis of axisLayouts) {
        const ticks = niceTicks(axis.min, axis.max, Math.max(3, Math.floor(plot.h / 52)))
        ctx.fillStyle = axis.color
        ctx.strokeStyle = axis.color
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.moveTo(axis.spineX, plot.y)
        ctx.lineTo(axis.spineX, plot.y + plot.h)
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.textAlign = axis.side === 'left' ? 'right' : 'left'
        const labelX = axis.side === 'left' ? axis.spineX - 6 : axis.spineX + 6
        for (const tick of ticks) {
          const y = axis.toY(tick)
          ctx.beginPath()
          if (axis.side === 'left') {
            ctx.moveTo(axis.spineX, y)
            ctx.lineTo(axis.spineX - 4, y)
          } else {
            ctx.moveTo(axis.spineX, y)
            ctx.lineTo(axis.spineX + 4, y)
          }
          ctx.stroke()
          ctx.fillText(fmtNum(tick, 3), labelX, y)
        }
        ctx.textBaseline = 'bottom'
        ctx.fillText(axis.unit || 'value', labelX, plot.y - 2)
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
      }

      const hoverEl = hoverRef.current
      if (hoverEl) {
        if (hoverT != null && ptr) {
          const rows = sers
            .filter((s) => s.visible)
            .map((s) => {
              const yv = sampleAt(s.t, s.y, hoverT, s.step)
              const hot = hoverKeys.has(s.key)
              return { s, yv, hot }
            })
          if (focusing) rows.sort((a, b) => Number(b.hot) - Number(a.hot))
          const html = rows
            .map((row) => {
              const cls = row.hot ? 'row hot' : focusing ? 'row dim' : 'row'
              return `<div class="${cls}"><span class="swatch" style="background:${row.s.color}"></span>${escapeHtml(row.s.name)} <b>${fmtNum(row.yv, 3)}</b> ${escapeHtml(row.s.unit)}</div>`
            })
            .join('')
          hoverEl.innerHTML = `<div class="t">${fmtTime(hoverT, span, abs)}</div>${html}`
          hoverEl.style.display = 'block'
          const left = Math.min(ptr.x + 14, cssW - 220)
          const top = Math.min(ptr.y + 14, cssH - 12 - hoverEl.offsetHeight)
          hoverEl.style.left = `${Math.max(8, left)}px`
          hoverEl.style.top = `${Math.max(8, top)}px`
        } else {
          hoverEl.style.display = 'none'
        }
      }
    }

    drawRef.current = draw
    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    drawRef.current()
  }, [series, axes, events, t0, t1, fullT0, fullT1, absolute, tool, measureCursors, active])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const tFromEvent = (ev: PointerEvent) => {
      const layout = layoutRef.current
      if (!layout) return null
      const rect = canvas.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const y = ev.clientY - rect.top
      pointerRef.current = { x, y }
      const { plot } = layout
      if (x < plot.x - 8 || x > plot.x + plot.w + 8) return { t: null, x, y, plot }
      const { t0: rt0, t1: rt1 } = rangeRef.current
      const t = rt0 + ((x - plot.x) / plot.w) * (rt1 - rt0)
      return { t, x, y, plot }
    }

    const snapT = (t: number) => {
      const sers = seriesRef.current.filter((s) => s.visible)
      const src = sers[0]
      if (!src || src.t.length === 0) return t
      const i = nearestIndex(src.t, t)
      return src.t[i]
    }

    const nearCursor = (x: number): string | null => {
      const layout = layoutRef.current
      if (!layout) return null
      const { t0: rt0, t1: rt1, measureCursors: cursors } = rangeRef.current
      const span = rt1 - rt0
      let best: string | null = null
      let bestD = 7
      cursors.forEach((cursor) => {
        const cx = layout.plot.x + ((cursor.t - rt0) / span) * layout.plot.w
        const d = Math.abs(cx - x)
        if (d < bestD) {
          bestD = d
          best = cursor.id
        }
      })
      return best
    }

    const onDown = (ev: PointerEvent) => {
      onActivate?.()
      const hit = tFromEvent(ev)
      if (!hit || hit.t == null) return
      canvas.setPointerCapture(ev.pointerId)
      const { tool: currentTool, t0: rt0, t1: rt1 } = rangeRef.current
      if (currentTool === 'measure') {
        if (ev.button === 2) {
          const id = nearCursor(hit.x)
          if (id) onMeasureRemove(id)
          ev.preventDefault()
          return
        }
        const id = nearCursor(hit.x)
        if (id) dragMeasureRef.current = id
        else onMeasureAdd(snapT(hit.t))
        return
      }
      if (currentTool === 'zoom') {
        zoomRef.current = { x0: hit.x, y0: hit.y, x1: hit.x, y1: hit.y }
        drawRef.current()
        return
      }
      panRef.current = { x: hit.x, t0: rt0, t1: rt1 }
    }

    const onMove = (ev: PointerEvent) => {
      const hit = tFromEvent(ev)
      if (!hit) return
      hoverTRef.current = hit.t
      if (dragMeasureRef.current != null && hit.t != null) {
        onMeasureMove(dragMeasureRef.current, snapT(hit.t))
      } else if (zoomRef.current) {
        zoomRef.current.x1 = hit.x
        zoomRef.current.y1 = hit.y
      } else if (panRef.current && hit.plot) {
        const dx = hit.x - panRef.current.x
        const span = panRef.current.t1 - panRef.current.t0
        const dt = -(dx / hit.plot.w) * span
        const next = clampRange(
          panRef.current.t0 + dt,
          panRef.current.t1 + dt,
          rangeRef.current.fullT0,
          rangeRef.current.fullT1,
        )
        onPan(next.t0, next.t1)
      }
      drawRef.current()
    }

    const onUp = (ev: PointerEvent) => {
      const zoom = zoomRef.current
      if (zoom) {
        const layout = layoutRef.current
        if (layout) {
          const { t0: rt0, t1: rt1 } = rangeRef.current
          const span = rt1 - rt0
          const xa = Math.min(zoom.x0, zoom.x1)
          const xb = Math.max(zoom.x0, zoom.x1)
          if (xb - xa > 8) {
            const za = rt0 + ((xa - layout.plot.x) / layout.plot.w) * span
            const zb = rt0 + ((xb - layout.plot.x) / layout.plot.w) * span
            const next = clampRange(za, zb, rangeRef.current.fullT0, rangeRef.current.fullT1)
            onZoom(next.t0, next.t1)
          }
        }
      }
      zoomRef.current = null
      panRef.current = null
      dragMeasureRef.current = null
      try {
        canvas.releasePointerCapture(ev.pointerId)
      } catch {
        /* already released */
      }
      drawRef.current()
    }

    const onLeave = () => {
      hoverTRef.current = null
      pointerRef.current = null
      const el = hoverRef.current
      if (el) el.style.display = 'none'
      drawRef.current()
    }

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const layout = layoutRef.current
      if (!layout) return
      const { t0: rt0, t1: rt1, fullT0: f0, fullT1: f1 } = rangeRef.current
      const span = rt1 - rt0
      const t = rt0 + ((x - layout.plot.x) / layout.plot.w) * span
      const z = ev.deltaY > 0 ? 1.18 : 1 / 1.18
      const next = clampRange(t + (rt0 - t) * z, t + (rt1 - t) * z, f0, f1)
      onZoom(next.t0, next.t1)
    }

    const onDbl = () => {
      onZoom(rangeRef.current.fullT0, rangeRef.current.fullT1)
    }

    const onCtx = (ev: Event) => ev.preventDefault()

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('dblclick', onDbl)
    canvas.addEventListener('contextmenu', onCtx)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('dblclick', onDbl)
      canvas.removeEventListener('contextmenu', onCtx)
    }
  }, [onPan, onZoom, onMeasureAdd, onMeasureMove, onMeasureRemove, onActivate])

  return (
    <div ref={wrapRef} className="chart-wrap">
      <canvas ref={canvasRef} />
      <div ref={hoverRef} className="chart-hover" />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
