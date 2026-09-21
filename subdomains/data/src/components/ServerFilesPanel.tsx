import { useCallback, useEffect, useState } from 'react'
import { downloadServerFile, fetchServerCatalog, normalizeCsvName, onlineFileId, onlineRequest,
  type OnlineApiError, type ServerDay } from '../lib/online'
import { useTelemetry } from '../store'

type Source = { id: string; name: string; folder: string; buffer: ArrayBuffer }
type RenameTarget = { day: string; name: string; newDay: string; newName: string }

export function ServerFilesPanel({ revision, onOpenManager, onLoad }: {
  revision: number
  onOpenManager: () => void
  onLoad: (items: Source[]) => Promise<void>
}) {
  const { files, dispatch } = useTelemetry()
  const [days, setDays] = useState<ServerDay[] | null>(null)
  const [checking, setChecking] = useState(true)
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<RenameTarget | null>(null)
  const loaded = new Set(files.map((file) => file.id))
  const count = days?.reduce((total, day) => total + day.files.length, 0) ?? 0

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setChecking(true)
    setError('')
    try {
      const status = await onlineRequest('status', { signal })
      const body = await status.json() as { authenticated: boolean }
      if (!body.authenticated) setDays(null)
      else setDays(await fetchServerCatalog(signal))
    } catch (caught) {
      if (!signal?.aborted) {
        const failure = caught as OnlineApiError
        setDays(null)
        setError(failure.message)
      }
    } finally {
      if (!signal?.aborted) setChecking(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh, revision])

  async function open(day: string, name: string) {
    const id = onlineFileId(day, name)
    if (loaded.has(id)) return
    setBusyKey(id)
    setError('')
    try { await onLoad([await downloadServerFile(day, name)]) }
    catch (caught) { setError((caught as Error).message) }
    finally { setBusyKey('') }
  }

  async function renameFile(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    const nextName = normalizeCsvName(editing.newName)
    const nextDay = editing.newDay.trim()
    if (!nextDay || !nextName) {
      setError('Enter a testing date and CSV filename.')
      return
    }
    if (nextDay === editing.day && nextName === editing.name) {
      setError('Change the testing date or filename before saving.')
      return
    }
    const id = onlineFileId(editing.day, editing.name)
    setBusyKey(id)
    setError('')
    try {
      await onlineRequest('file', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day: editing.day, name: editing.name, newDay: nextDay, newName: nextName }),
      })
      if (loaded.has(id)) {
        dispatch({ type: 'remove-file', fileId: id })
        await onLoad([await downloadServerFile(nextDay, nextName)])
      }
      setEditing(null)
      await refresh()
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusyKey('') }
  }

  async function deleteFile(day: string, name: string) {
    if (!window.confirm(`Delete ${day}/${name} from the server? This cannot be undone.`)) return
    const id = onlineFileId(day, name)
    setBusyKey(id)
    setError('')
    try {
      await onlineRequest('file', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, name }),
      })
      if (loaded.has(id)) dispatch({ type: 'remove-file', fileId: id })
      await refresh()
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusyKey('') }
  }

  return (
    <section className="server-files" aria-label="Server files">
      <div className="server-files-head">
        <div>
          <div className="kicker">Server files</div>
          <strong>{days === null ? 'Locked' : `${count} CSV${count === 1 ? '' : 's'}`}</strong>
        </div>
        <div className="server-file-actions">
          <button type="button" className="tiny" title="Refresh server files" onClick={() => void refresh()}>↻</button>
          <button type="button" className="btn compact accent" onClick={onOpenManager}>
            {days === null ? 'Unlock' : 'Upload new'}
          </button>
        </div>
      </div>
      {checking ? <p className="empty-lite">Checking server…</p> : days === null ? (
        <p className="empty-lite">Unlock to browse and manage the persistent file library.</p>
      ) : days.length === 0 ? (
        <p className="empty-lite">No server CSVs yet. Use Upload new to add one.</p>
      ) : (
        <div className="server-file-list">
          {days.map((day) => (
            <div key={day.name} className="server-day">
              <div className="server-day-name"><span>{day.name}</span><span>{day.files.length}</span></div>
              {day.files.map((file) => {
                const id = onlineFileId(day.name, file.name)
                const isLoaded = loaded.has(id)
                const query = new URLSearchParams({ day: day.name, name: file.name })
                return (
                  <div key={file.name} className="server-file-row">
                    <button type="button" className="server-file-name" title={file.name}
                      disabled={Boolean(busyKey) || isLoaded} onClick={() => void open(day.name, file.name)}>
                      <span>{file.name.replace(/\.csv$/i, '')}</span>
                      {isLoaded && <em>open</em>}
                    </button>
                    <a className="tiny" title="Download CSV" href={`/api/online/file?${query}`} download={file.name}>↓</a>
                    <button type="button" className="tiny" title="Rename CSV" disabled={Boolean(busyKey)}
                      onClick={() => {
                        setError('')
                        setEditing({ day: day.name, name: file.name, newDay: day.name, newName: file.name })
                      }}>✎</button>
                    <button type="button" className="tiny danger" title="Delete CSV" disabled={Boolean(busyKey)}
                      onClick={() => void deleteFile(day.name, file.name)}>×</button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <form className="server-rename-form" onSubmit={(event) => void renameFile(event)}>
          <div className="server-rename-title" title={`${editing.day}/${editing.name}`}>
            Move or rename <strong>{editing.name}</strong>
          </div>
          <label>Date
            <input type="date" required disabled={Boolean(busyKey)} value={editing.newDay}
              onChange={(event) => setEditing({ ...editing, newDay: event.target.value })} />
          </label>
          <label>Filename
            <input type="text" required disabled={Boolean(busyKey)} value={editing.newName}
              aria-label="New CSV filename" onChange={(event) => setEditing({ ...editing, newName: event.target.value })} />
          </label>
          <div className="server-rename-actions">
            <button type="button" className="btn compact" disabled={Boolean(busyKey)} onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="btn compact accent" disabled={Boolean(busyKey)}>Save</button>
          </div>
        </form>
      )}
      {error && <p className="server-file-error" role="alert">{error}</p>}
    </section>
  )
}
