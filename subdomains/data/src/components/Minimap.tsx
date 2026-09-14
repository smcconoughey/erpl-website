import { useEffect, useRef } from 'react'
import { minMaxBuckets } from '../lib/math'
import { useTelemetry } from '../store'

export function Minimap() {
  const { fullSpan, visibleRange, plots, channelMap, timeMode, views, dispatch } = useTelemetry()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<'move' | 'l' | 'r' | null>(null)
  const startRef = useRef<{ x: number; t0: number; t1: number } | null>(null)

  const spark = (() => {
    for (const plot of plots) {
      for (const s of plot.series) {
        if (!s.visible) continue
        const ch = channelMap.get(s.channelKey)
        if (!ch) continue
        return {
          t: timeMode === 'absolute' ? ch.tAbs : ch.tElapsed,
          y: ch.values,
          color: s.color,
        }
      }
    }
    return null
  })()

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !fullSpan || !visibleRange) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const cssW = wrap.clientWidth
      const cssH = wrap.clientHeight
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(cssW * dpr)
      canvas.height = Math.floor(cssH * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)
      ctx.fillStyle = '#10131a'
      ctx.fillRect(0, 0, cssW, cssH)

      const pad = 10
      const x0 = pad
      const w = cssW - pad * 2
      const y0 = 8
      const h = cssH - 16
      const span = fullSpan.t1 - fullSpan.t0 || 1
      const toX = (t: number) => x0 + ((t - fullSpan.t0) / span) * w

      if (spark) {
        const buckets = Math.max(32, Math.floor(w))
        const { mins, maxs, counts } = minMaxBuckets(spark.t, spark.y, fullSpan.t0, fullSpan.t1, buckets)
        let gmin = Infinity
        let gmax = -Infinity
        for (let i = 0; i < buckets; i++) {
          if (!counts[i]) continue
          gmin = Math.min(gmin, mins[i])
          gmax = Math.max(gmax, maxs[i])
        }
        if (!Number.isFinite(gmin)) {
          gmin = 0
          gmax = 1
        }
        const ys = gmax - gmin || 1
        ctx.strokeStyle = spark.color
        ctx.globalAlpha = 0.7
        ctx.beginPath()
        let started = false
        for (let i = 0; i < buckets; i++) {
          if (!counts[i]) {
            started = false
            continue
          }
          const x = x0 + ((i + 0.5) / buckets) * w
          const y = y0 + h - ((mins[i] + maxs[i]) / 2 - gmin) / ys * h
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      for (const v of views) {
        if (v.timeMode !== timeMode) continue
        const x = toX((v.t0 + v.t1) / 2)
        ctx.fillStyle = '#4da3ff'
        ctx.fillRect(x - 1, y0, 2, h)
      }

      const wx0 = toX(visibleRange.t0)
      const wx1 = toX(visibleRange.t1)
      ctx.fillStyle = 'rgba(77,163,255,0.12)'
      ctx.strokeStyle = '#4da3ff'
      ctx.fillRect(wx0, y0, Math.max(2, wx1 - wx0), h)
      ctx.strokeRect(wx0, y0, Math.max(2, wx1 - wx0), h)
      ctx.fillStyle = '#4da3ff'
      ctx.fillRect(wx0 - 2, y0, 4, h)
      ctx.fillRect(wx1 - 2, y0, 4, h)
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [fullSpan, visibleRange, spark, views, timeMode])

  if (!fullSpan || !visibleRange) return null

  const hit = (clientX: number) => {
    const wrap = wrapRef.current
    if (!wrap) return null
    const rect = wrap.getBoundingClientRect()
    const pad = 10
    const w = rect.width - pad * 2
    const x = clientX - rect.left - pad
    const t = fullSpan.t0 + (x / w) * (fullSpan.t1 - fullSpan.t0)
    const toX = (tv: number) => pad + ((tv - fullSpan.t0) / (fullSpan.t1 - fullSpan.t0)) * w
    const x0 = toX(visibleRange.t0)
    const x1 = toX(visibleRange.t1)
    const px = clientX - rect.left
    if (Math.abs(px - x0) < 6) return { mode: 'l' as const, t }
    if (Math.abs(px - x1) < 6) return { mode: 'r' as const, t }
    if (px > x0 && px < x1) return { mode: 'move' as const, t }
    return { mode: 'jump' as const, t }
  }

  return (
    <div className="minimap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          const h = hit(e.clientX)
          if (!h) return
          e.currentTarget.setPointerCapture(e.pointerId)
          if (h.mode === 'jump') {
            const span = visibleRange.t1 - visibleRange.t0
            let t0 = h.t - span / 2
            let t1 = h.t + span / 2
            if (t0 < fullSpan.t0) {
              t1 += fullSpan.t0 - t0
              t0 = fullSpan.t0
            }
            if (t1 > fullSpan.t1) {
              t0 -= t1 - fullSpan.t1
              t1 = fullSpan.t1
            }
            dispatch({ type: 'set-range', range: { t0: Math.max(t0, fullSpan.t0), t1: Math.min(t1, fullSpan.t1) } })
            return
          }
          dragRef.current = h.mode
          startRef.current = { x: e.clientX, t0: visibleRange.t0, t1: visibleRange.t1 }
        }}
        onPointerMove={(e) => {
          if (!dragRef.current || !startRef.current || !wrapRef.current) return
          const rect = wrapRef.current.getBoundingClientRect()
          const w = rect.width - 20
          const dt = ((e.clientX - startRef.current.x) / w) * (fullSpan.t1 - fullSpan.t0)
          let t0 = startRef.current.t0
          let t1 = startRef.current.t1
          if (dragRef.current === 'move') {
            t0 += dt
            t1 += dt
          } else if (dragRef.current === 'l') {
            t0 += dt
          } else {
            t1 += dt
          }
          if (t1 - t0 < (fullSpan.t1 - fullSpan.t0) * 0.002) return
          if (t0 < fullSpan.t0) {
            if (dragRef.current === 'move') t1 += fullSpan.t0 - t0
            t0 = fullSpan.t0
          }
          if (t1 > fullSpan.t1) {
            if (dragRef.current === 'move') t0 -= t1 - fullSpan.t1
            t1 = fullSpan.t1
          }
          dispatch({ type: 'set-range', range: { t0, t1 } })
        }}
        onPointerUp={() => {
          dragRef.current = null
          startRef.current = null
        }}
      />
    </div>
  )
}
