import { useEffect, useMemo, useState } from 'react'
import { fmtNum } from '../lib/math'
import { useTelemetry } from '../store'
import { ServerFilesPanel } from './ServerFilesPanel'

type Source = { id: string; name: string; folder: string; buffer: ArrayBuffer }

export function Sidebar({ serverRevision, onOpenServer, onLoadServer }: {
  serverRevision: number
  onOpenServer: () => void
  onLoadServer: (items: Source[]) => Promise<void>
}) {
  const { files, plots, activePlotId, dispatch } = useTelemetry()
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const seenFiles = useState(() => new Set<string>())[0]
  const query = q.trim().toLowerCase()

  useEffect(() => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      files.forEach((file, i) => {
        if (seenFiles.has(file.id)) return
        seenFiles.add(file.id)
        if (seenFiles.size > 1 || i > 0) next.add(`file:${file.id}`)
      })
      return next
    })
  }, [files, seenFiles])

  const selected = useMemo(() => {
    const keys = new Set<string>()
    for (const plot of plots) {
      for (const s of plot.series) keys.add(s.channelKey)
    }
    return keys
  }, [plots])

  const tree = useMemo(() => groupFiles(files), [files])

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="sidebar">
      <div className="side-head">
        <div>
          <div className="kicker">Channels</div>
          <h2>Campaign</h2>
        </div>
        <span className="count">{files.length} files</span>
      </div>
      <input
        className="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter channels"
      />
      <div className="tree">
        {files.length === 0 && <p className="empty-lite">Open a local or server CSV to see its channels.</p>}
        {tree.map((folder) => {
          const folderId = `folder:${folder.path || '_root'}`
          const hideFolder = collapsed.has(folderId) && !query
          return (
            <div key={folderId} className="tree-folder">
              <button type="button" className="tree-row folder" onClick={() => toggle(folderId)}>
                <span className="chev">{hideFolder ? '▸' : '▾'}</span>
                <span className="label">{folder.path || 'This folder'}</span>
                <span className="meta">{folder.files.length}</span>
              </button>
              {!hideFolder &&
                folder.files.map((file) => {
                  const fileId = `file:${file.id}`
                  const hideFile = collapsed.has(fileId) && !query
                  const duration = file.tElapsed.length
                    ? file.tElapsed[file.tElapsed.length - 1] - file.tElapsed[0]
                    : 0
                  return (
                    <div key={file.id} className="tree-file">
                      <div className="tree-row file">
                        <button type="button" className="tree-main" onClick={() => toggle(fileId)}>
                          <span className="chev">{hideFile ? '▸' : '▾'}</span>
                          <span className="label" title={file.name}>
                            {file.name.replace(/\.csv$/i, '')}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="tiny"
                          title="Remove file"
                          onClick={() => dispatch({ type: 'remove-file', fileId: file.id })}
                        >
                          ×
                        </button>
                      </div>
                      <div className="file-meta">
                        {file.rowCount.toLocaleString()} rows · {fmtNum(duration, 2)} s
                      </div>
                      {!hideFile &&
                        groupsOf(file, query).map((group) => {
                          const groupId = `${file.id}:${group.name}`
                          const hideGroup = collapsed.has(groupId) && !query
                          return (
                            <div key={groupId}>
                              <button
                                type="button"
                                className="tree-row group"
                                onClick={() => toggle(groupId)}
                              >
                                <span className="chev">{hideGroup ? '▸' : '▾'}</span>
                                <span className="label">{group.name}</span>
                                <span className="meta">{group.channels.length}</span>
                              </button>
                              {!hideGroup &&
                                group.channels.map((ch) => {
                                  const on = selected.has(ch.key)
                                  const color = plots
                                    .flatMap((p) => p.series)
                                    .find((s) => s.channelKey === ch.key)?.color
                                  return (
                                    <button
                                      key={ch.key}
                                      type="button"
                                      className={`tree-row channel${on ? ' on' : ''}`}
                                      draggable
                                      onDragStart={(e) => {
                                        e.dataTransfer.setData('text/channel-key', ch.key)
                                        e.dataTransfer.effectAllowed = 'copy'
                                      }}
                                      onClick={() =>
                                        dispatch({
                                          type: 'toggle-channel',
                                          channelKey: ch.key,
                                          plotId: activePlotId ?? undefined,
                                        })
                                      }
                                    >
                                      <span
                                        className="dot"
                                        style={{ background: on ? color : 'transparent' }}
                                      />
                                      <span className="label" title={ch.name}>
                                        {ch.name}
                                      </span>
                                      {ch.unit ? <span className="unit">{ch.unit}</span> : null}
                                    </button>
                                  )
                                })}
                            </div>
                          )
                        })}
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
      <ServerFilesPanel revision={serverRevision} onOpenManager={onOpenServer} onLoad={onLoadServer} />
    </aside>
  )
}

function groupFiles(files: TelemetryFileLike[]) {
  const map = new Map<string, TelemetryFileLike[]>()
  for (const file of files) {
    const key = file.folder || ''
    const list = map.get(key) ?? []
    list.push(file)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, grouped]) => ({ path, files: grouped }))
}

function groupsOf(file: TelemetryFileLike, query: string) {
  const map = new Map<string, TelemetryFileLike['channels']>()
  for (const ch of file.channels) {
    if (query) {
      const hay = `${file.folder} ${file.name} ${ch.name} ${ch.unit} ${ch.group}`.toLowerCase()
      if (!hay.includes(query)) continue
    }
    const list = map.get(ch.group) ?? []
    list.push(ch)
    map.set(ch.group, list)
  }
  return [...map.entries()].map(([name, channels]) => ({ name, channels }))
}

type TelemetryFileLike = {
  id: string
  name: string
  folder: string
  rowCount: number
  tElapsed: Float64Array
  channels: { key: string; name: string; unit: string; group: string }[]
}
