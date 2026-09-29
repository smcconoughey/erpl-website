import { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { LibraryDocument } from './LibraryApp'

type GraphNode = SimulationNodeDatum & {
  id: string
  document: LibraryDocument
  degree: number
  radius: number
}

type GraphLink = SimulationLinkDatum<GraphNode> & {
  source: string | GraphNode
  target: string | GraphNode
}

type Camera = { x: number; y: number; scale: number }

const colorFor = (document: LibraryDocument) => {
  if (document.path.startsWith('Topics/')) return '#46bce8'
  if (document.path.startsWith('Sources/Records/')) return '#b8b9bd'
  if (document.path.startsWith('Feedback/')) return '#68d59a'
  if (document.path.startsWith('System/')) return '#61a9ff'
  return '#a9afb8'
}

const nodeOf = (value: string | GraphNode) => typeof value === 'string' ? null : value

export function LibraryGraph({ documents, matchedPaths, query, selectedPath, onSelect, onOpen }: {
  documents: LibraryDocument[]
  matchedPaths: Set<string>
  query: string
  selectedPath: string
  onSelect: (path: string) => void
  onOpen: (path: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 })
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 })
  const hoverRef = useRef<GraphNode | null>(null)
  const interactionRef = useRef<{
    type: 'pan' | 'node'; node?: GraphNode; startX: number; startY: number; lastX: number; lastY: number; moved: boolean
  } | null>(null)
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [localOnly, setLocalOnly] = useState(false)
  const [hoveredPath, setHoveredPath] = useState('')
  const selected = documents.find((document) => document.path === selectedPath)

  const graphDocuments = useMemo(() => documents.filter((document) => document.kind === 'markdown'), [documents])
  const graphLinkCount = useMemo(() => {
    const paths = new Set(graphDocuments.map((document) => document.path))
    const links = new Set<string>()
    graphDocuments.forEach((document) => document.links.forEach((target) => {
      if (paths.has(target) && target !== document.path) links.add([document.path, target].sort().join('\u0000'))
    }))
    return links.size
  }, [graphDocuments])

  const visiblePaths = useMemo(() => {
    if (!localOnly || !selectedPath) return null
    const paths = new Set([selectedPath])
    const selectedDocument = graphDocuments.find((document) => document.path === selectedPath)
    selectedDocument?.links.forEach((path) => paths.add(path))
    graphDocuments.forEach((document) => {
      if (document.links.includes(selectedPath)) paths.add(document.path)
    })
    return paths
  }, [graphDocuments, localOnly, selectedPath])

  useEffect(() => {
    const graphPaths = new Set(graphDocuments.map((document) => document.path))
    const degree = new Map(graphDocuments.map((document) => [document.path, 0]))
    const links: GraphLink[] = []
    const linkKeys = new Set<string>()
    graphDocuments.forEach((document) => document.links.forEach((target) => {
      if (!graphPaths.has(target) || target === document.path) return
      const key = [document.path, target].sort().join('\u0000')
      if (linkKeys.has(key)) return
      linkKeys.add(key)
      links.push({ source: document.path, target })
      degree.set(document.path, (degree.get(document.path) || 0) + 1)
      degree.set(target, (degree.get(target) || 0) + 1)
    }))
    const nodes: GraphNode[] = graphDocuments.map((document, index) => {
      const angle = index * 2.399963229728653
      const radius = 38 * Math.sqrt(index + 1)
      const connections = degree.get(document.path) || 0
      return {
        id: document.path,
        document,
        degree: connections,
        radius: 3.4 + Math.min(8, Math.sqrt(connections) * 1.45) + (document.path.startsWith('Topics/') ? 1.4 : 0),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      }
    })
    nodesRef.current = nodes
    linksRef.current = links
    const simulation = forceSimulation(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id((node) => node.id).distance((link) => {
        const source = nodeOf(link.source)
        const target = nodeOf(link.target)
        return source?.document.path.startsWith('Topics/') || target?.document.path.startsWith('Topics/') ? 160 : 120
      }).strength(0.3))
      .force('charge', forceManyBody<GraphNode>().strength((node) => -170 - Math.min(node.degree, 18) * 11).distanceMax(900))
      .force('collide', forceCollide<GraphNode>().radius((node) => node.radius + 24).strength(0.8))
      .force('center', forceCenter(0, 0).strength(0.03))
      .force('x', forceX<GraphNode>(0).strength(0.012))
      .force('y', forceY<GraphNode>(0).strength(0.012))
      .alphaDecay(0.022)
      .velocityDecay(0.34)
      .on('tick', () => drawRef.current())
    simulationRef.current = simulation
    return () => { simulation.stop(); simulationRef.current = null }
  }, [graphDocuments])

  useEffect(() => {
    const canvas = canvasRef.current
    const shell = shellRef.current
    if (!canvas || !shell) return
    const resize = () => {
      const rect = shell.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      sizeRef.current = { width: rect.width, height: rect.height, dpr }
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      if (!cameraRef.current.x && !cameraRef.current.y) cameraRef.current = { x: rect.width / 2, y: rect.height / 2, scale: 0.9 }
      drawRef.current()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(shell)
    resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const context = canvas.getContext('2d')
      if (!context) return
      const { width, height, dpr } = sizeRef.current
      const camera = cameraRef.current
      const hovered = hoverRef.current
      const localPaths = visiblePaths
      const queryActive = Boolean(query.trim())
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#171717'
      context.fillRect(0, 0, width, height)
      context.save()
      context.translate(camera.x, camera.y)
      context.scale(camera.scale, camera.scale)

      for (const link of linksRef.current) {
        const source = nodeOf(link.source)
        const target = nodeOf(link.target)
        if (!source || !target || source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue
        if (localPaths && (!localPaths.has(source.id) || !localPaths.has(target.id))) continue
        const adjacent = hovered && (source.id === hovered.id || target.id === hovered.id)
        const selectedAdjacent = selectedPath && (source.id === selectedPath || target.id === selectedPath)
        const searchAdjacent = queryActive && matchedPaths.has(source.id) && matchedPaths.has(target.id)
        context.beginPath()
        context.moveTo(source.x, source.y)
        context.lineTo(target.x, target.y)
        context.strokeStyle = adjacent ? 'rgba(119, 190, 238, .8)' : selectedAdjacent ? 'rgba(89, 154, 205, .58)' : searchAdjacent ? 'rgba(102, 170, 220, .5)' : 'rgba(104, 108, 114, .22)'
        context.lineWidth = (adjacent ? 1.6 : selectedAdjacent ? 1.1 : .75) / camera.scale
        context.stroke()
      }

      for (const node of nodesRef.current) {
        if (node.x === undefined || node.y === undefined || (localPaths && !localPaths.has(node.id))) continue
        const isHovered = hovered?.id === node.id
        const isSelected = selectedPath === node.id
        const isMatch = !queryActive || matchedPaths.has(node.id)
        const radius = node.radius + (isHovered || isSelected ? 2.5 : 0)
        context.globalAlpha = isMatch ? 1 : .16
        context.beginPath()
        context.arc(node.x, node.y, radius, 0, Math.PI * 2)
        context.fillStyle = isSelected ? '#f1c66b' : colorFor(node.document)
        context.shadowColor = isHovered || isSelected ? context.fillStyle : 'transparent'
        context.shadowBlur = (isHovered || isSelected ? 14 : 0) / camera.scale
        context.fill()
        context.shadowBlur = 0
        if (isSelected) {
          context.beginPath()
          context.arc(node.x, node.y, radius + 4 / camera.scale, 0, Math.PI * 2)
          context.strokeStyle = 'rgba(241,198,107,.65)'
          context.lineWidth = 1.3 / camera.scale
          context.stroke()
        }
        const important = node.degree >= 8 || node.document.path.startsWith('Topics/')
        if (showLabels && (camera.scale > 1.15 || important || isHovered || isSelected || (queryActive && isMatch))) {
          const fontSize = Math.max(8.5, 11 / Math.sqrt(camera.scale))
          context.font = `${isHovered || isSelected ? 600 : 400} ${fontSize}px system-ui, sans-serif`
          context.textAlign = 'center'
          context.textBaseline = 'top'
          context.fillStyle = isSelected ? '#fff2c7' : '#d7d8db'
          context.shadowColor = '#171717'
          context.shadowBlur = 4 / camera.scale
          context.fillText(node.document.title, node.x, node.y + radius + 4 / camera.scale)
          context.shadowBlur = 0
        }
        context.globalAlpha = 1
      }
      context.restore()
    }
    drawRef.current()
  }, [matchedPaths, query, selectedPath, showLabels, visiblePaths])

  const graphPoint = (event: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top
    const camera = cameraRef.current
    return { screenX, screenY, x: (screenX - camera.x) / camera.scale, y: (screenY - camera.y) / camera.scale }
  }

  const hitNode = (x: number, y: number) => {
    const localPaths = visiblePaths
    let closest: GraphNode | null = null
    let distance = Infinity
    for (const node of nodesRef.current) {
      if (node.x === undefined || node.y === undefined || (localPaths && !localPaths.has(node.id))) continue
      const candidate = Math.hypot(node.x - x, node.y - y)
      if (candidate <= node.radius + 8 / cameraRef.current.scale && candidate < distance) {
        closest = node; distance = candidate
      }
    }
    return closest
  }

  const fit = () => {
    const nodes = visiblePaths ? nodesRef.current.filter((node) => visiblePaths.has(node.id)) : nodesRef.current
    if (!nodes.length) return
    const xs = nodes.map((node) => node.x || 0)
    const ys = nodes.map((node) => node.y || 0)
    const minX = Math.min(...xs); const maxX = Math.max(...xs)
    const minY = Math.min(...ys); const maxY = Math.max(...ys)
    const { width, height } = sizeRef.current
    const scale = Math.max(.2, Math.min(2.2, .84 * Math.min(width / Math.max(200, maxX - minX), height / Math.max(160, maxY - minY))))
    cameraRef.current = { x: width / 2 - ((minX + maxX) / 2) * scale, y: height / 2 - ((minY + maxY) / 2) * scale, scale }
    drawRef.current()
  }

  const zoom = (factor: number) => {
    const { width, height } = sizeRef.current
    const camera = cameraRef.current
    const next = Math.max(.2, Math.min(4, camera.scale * factor))
    const graphX = (width / 2 - camera.x) / camera.scale
    const graphY = (height / 2 - camera.y) / camera.scale
    cameraRef.current = { x: width / 2 - graphX * next, y: height / 2 - graphY * next, scale: next }
    drawRef.current()
  }

  useEffect(() => { const timer = window.setTimeout(fit, 900); return () => window.clearTimeout(timer) }, [graphDocuments])

  return <section className="library-graph" ref={shellRef}>
    <div className="graph-titlebar"><span>Graph view</span><button type="button" aria-label="Graph menu">•••</button></div>
    <canvas ref={canvasRef} aria-label={`Knowledge graph with ${graphDocuments.length} notes`}
      onPointerDown={(event) => {
        const point = graphPoint(event)
        const node = hitNode(point.x, point.y)
        event.currentTarget.setPointerCapture(event.pointerId)
        interactionRef.current = { type: node ? 'node' : 'pan', node: node || undefined, startX: point.screenX, startY: point.screenY, lastX: point.screenX, lastY: point.screenY, moved: false }
        if (node) { node.fx = node.x; node.fy = node.y; simulationRef.current?.alphaTarget(.12).restart() }
      }}
      onPointerMove={(event) => {
        const point = graphPoint(event)
        const interaction = interactionRef.current
        if (interaction) {
          const dx = point.screenX - interaction.lastX; const dy = point.screenY - interaction.lastY
          interaction.lastX = point.screenX; interaction.lastY = point.screenY
          if (Math.hypot(point.screenX - interaction.startX, point.screenY - interaction.startY) > 3) interaction.moved = true
          if (interaction.type === 'pan') {
            cameraRef.current.x += dx; cameraRef.current.y += dy
          } else if (interaction.node) {
            interaction.node.fx = point.x; interaction.node.fy = point.y
          }
          drawRef.current(); return
        }
        const node = hitNode(point.x, point.y)
        if (hoverRef.current?.id !== node?.id) {
          hoverRef.current = node
          setHoveredPath(node?.id || '')
          event.currentTarget.style.cursor = node ? 'pointer' : 'grab'
          drawRef.current()
        }
      }}
      onPointerUp={(event) => {
        const interaction = interactionRef.current
        if (interaction?.node) {
          interaction.node.fx = null; interaction.node.fy = null
          simulationRef.current?.alphaTarget(0)
          if (!interaction.moved) onSelect(interaction.node.id)
        }
        interactionRef.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onDoubleClick={(event) => {
        const point = graphPoint(event)
        const node = hitNode(point.x, point.y)
        if (node) onOpen(node.id)
      }}
      onWheel={(event) => {
        event.preventDefault()
        const point = graphPoint(event)
        const camera = cameraRef.current
        const next = Math.max(.2, Math.min(4, camera.scale * Math.exp(-event.deltaY * .0012)))
        cameraRef.current = { x: point.screenX - point.x * next, y: point.screenY - point.y * next, scale: next }
        drawRef.current()
      }} />
    <div className="graph-controls">
      <button type="button" onClick={() => setSettingsOpen((value) => !value)} aria-label="Graph settings">⚙</button>
      <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in">＋</button>
      <button type="button" onClick={() => zoom(.8)} aria-label="Zoom out">−</button>
      <button type="button" onClick={fit} aria-label="Fit graph">⌗</button>
    </div>
    {settingsOpen ? <div className="graph-settings">
      <div className="kicker">Graph settings</div>
      <label><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} /> Show labels</label>
      <label><input type="checkbox" checked={localOnly} disabled={!selectedPath} onChange={(event) => setLocalOnly(event.target.checked)} /> Local graph</label>
      <button type="button" className="btn compact" onClick={() => { simulationRef.current?.alpha(.9).restart(); setSettingsOpen(false) }}>Reheat layout</button>
    </div> : null}
    <div className="graph-legend">
      <span><i className="topic" /> Topics</span><span><i className="source" /> Sources</span><span><i className="feedback" /> Feedback</span><span><i className="system" /> System</span>
    </div>
    <div className="graph-status">{graphDocuments.length} nodes · {graphLinkCount} links · scroll to zoom · drag to pan</div>
    {(hoveredPath || selected) ? <div className="graph-node-card">
      <span className="kicker">{hoveredPath ? 'Linked note' : 'Selected note'}</span>
      <strong>{documents.find((document) => document.path === hoveredPath)?.title || selected?.title}</strong>
      <small>{hoveredPath || selected?.path}</small>
      {selected && !hoveredPath ? <button type="button" className="btn compact" onClick={() => onOpen(selected.path)}>Open note</button> : null}
    </div> : null}
  </section>
}
