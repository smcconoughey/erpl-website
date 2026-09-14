import { useEffect, useRef, useState } from 'react'
import { Inspector } from './components/Inspector'
import { Minimap } from './components/Minimap'
import { Plots } from './components/Plots'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { sourcesFromDataTransfer, sourcesFromFileList } from './lib/files'
import { uid } from './lib/math'
import { TelemetryProvider, useLoadFiles, useTelemetry } from './store'

export function App() {
  return (
    <TelemetryProvider>
      <Shell />
    </TelemetryProvider>
  )
}

function Shell() {
  const { files, error, dispatch, loading } = useTelemetry()
  const load = useLoadFiles()
  const [dragging, setDragging] = useState(false)
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
    folderRef.current?.setAttribute('directory', '')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '1') dispatch({ type: 'set-tool', tool: 'pan' })
      if (e.key === '2') dispatch({ type: 'set-tool', tool: 'zoom' })
      if (e.key === '3' || e.key.toLowerCase() === 'm') dispatch({ type: 'set-tool', tool: 'measure' })
      if (e.key.toLowerCase() === 'f') dispatch({ type: 'set-range', range: null })
      if (e.key === 'Escape') {
        dispatch({ type: 'clear-measure' })
        dispatch({ type: 'set-tool', tool: 'pan' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  const ingestBuffers = async (items: { name: string; folder: string; buffer: ArrayBuffer }[]) => {
    await load(items.map((item) => ({ ...item, id: uid('file') })))
  }

  const ingestSources = async (sources: { file: File; folder: string; name: string }[]) => {
    const items = await Promise.all(
      sources.map(async (s) => ({
        name: s.name,
        folder: s.folder,
        buffer: await s.file.arrayBuffer(),
      })),
    )
    await ingestBuffers(items)
  }

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) setDragging(true)
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragging(false)
        void sourcesFromDataTransfer(e.dataTransfer).then((sources) => ingestSources(sources))
      }}
    >
      <Toolbar
        onOpenFolder={() => folderRef.current?.click()}
        onOpenFiles={() => filesRef.current?.click()}
      />
      {error ? <div className="banner">{error}</div> : null}
      {files.length === 0 ? (
        <EmptyState
          loading={Boolean(loading)}
          onOpenFolder={() => folderRef.current?.click()}
          onOpenFiles={() => filesRef.current?.click()}
        />
      ) : (
        <div className="workspace">
          <Sidebar />
          <main className="stage">
            <Plots />
            <Minimap />
          </main>
          <Inspector />
        </div>
      )}
      {dragging ? <div className="drop-overlay">Drop CSV files or folders</div> : null}
      <input
        ref={folderRef}
        type="file"
        className="hidden"
        multiple
        accept=".csv,text/csv"
        onChange={(e) => {
          if (e.target.files) void ingestSources(sourcesFromFileList(e.target.files))
          e.target.value = ''
        }}
      />
      <input
        ref={filesRef}
        type="file"
        className="hidden"
        multiple
        accept=".csv,text/csv"
        onChange={(e) => {
          if (e.target.files) void ingestSources(sourcesFromFileList(e.target.files))
          e.target.value = ''
        }}
      />
    </div>
  )
}

function EmptyState({
  loading,
  onOpenFolder,
  onOpenFiles,
}: {
  loading: boolean
  onOpenFolder: () => void
  onOpenFiles: () => void
}) {
  return (
    <div className="empty">
      <div className="empty-card">
        <div className="kicker">ERPL telemetry</div>
        <h1>Load a campaign and plot vs time</h1>
        <p>
          Open a folder of CSVs or drop files here. Click channels to stack them on a plot. Use Zoom
          to box a window, save it as a view, then Measure to drop cursors and read ΔX, ΔY, and
          slope on every axis.
        </p>
        <div className="empty-actions">
          <button type="button" className="btn accent" disabled={loading} onClick={onOpenFolder}>
            Open folder
          </button>
          <button type="button" className="btn" disabled={loading} onClick={onOpenFiles}>
            Open files
          </button>
        </div>
        <ul className="legend-help">
          <li>
            <b>Pan</b> drag the plot · wheel zooms time
          </li>
          <li>
            <b>Zoom</b> drag a time window · double-click fits
          </li>
          <li>
            <b>Measure</b> click multiple points · inspector shows slope / ΔY / ΔX
          </li>
          <li>
            <b>Axes</b> series sharing a unit share an axis · ⧉ splits onto its own scale
          </li>
        </ul>
      </div>
    </div>
  )
}
