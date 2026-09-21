import { useEffect, useRef, useState } from 'react'
import { normalizeCsvName } from '../lib/online'
import { useTelemetry } from '../store'

type TestDay = { name: string; files: { name: string }[] }
type Source = { id: string; name: string; folder: string; buffer: ArrayBuffer }
type ApiError = { error?: string; retryAfter?: number; attemptsRemaining?: number }
type UploadItem = { id: string; file: File; day: string; name: string }
// Stable online identities distinguish server files from local files with the same name.
const key = (day: string, name: string) => `online:${JSON.stringify([day, name])}`
const localDate = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`/api/online/${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body: ApiError = await response.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || 'Unable to reach online data. Please try again.'), body, { status: response.status })
  }
  return response
}

export function OnlineDataDialog({ onClose, onLoad }: {
  onClose: () => void
  onLoad: (items: Source[]) => Promise<void>
}) {
  const { files } = useTelemetry()
  const loadedIds = new Set(files.map((file) => file.id))
  const dialogRef = useRef<HTMLDialogElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [password, setPassword] = useState('')
  const [days, setDays] = useState<TestDay[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(true)
  const [checking, setChecking] = useState(true)
  const [message, setMessage] = useState('Checking access…')
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(5)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [uploadDay, setUploadDay] = useState(localDate)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const controllerRef = useRef<AbortController | null>(null)
  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000))
  const newCount = [...selected].filter((id) => !loadedIds.has(id)).length

  async function openCatalog(signal: AbortSignal) {
    const response = await request('catalog', { signal })
    const catalog = await response.json() as { days: TestDay[] }
    if (signal.aborted) return
    setDays(catalog.days)
    setSelected(new Set(catalog.days.flatMap((day) => day.files
      .map((file) => key(day.name, file.name)).filter((id) => loadedIds.has(id)))))
  }

  function showError(caught: unknown) {
    const failure = caught as ApiError & { message?: string; status?: number }
    setError(failure.error || failure.message || 'Unable to reach online data. Please try again.')
    if (failure.attemptsRemaining !== undefined) setAttempts(failure.attemptsRemaining)
    if (failure.retryAfter) {
      setLockedUntil(Date.now() + failure.retryAfter * 1000)
      setNow(Date.now())
    }
    if (failure.status === 401) { setDays(null); setSelected(new Set()) }
  }

  useEffect(() => {
    const dialog = dialogRef.current!
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.showModal()
    const controller = new AbortController()
    void request('status', { signal: controller.signal })
      .then((response) => response.json())
      .then(async (body: { authenticated: boolean; attemptsRemaining: number }) => {
        if (controller.signal.aborted) return
        setAttempts(body.attemptsRemaining)
        if (body.authenticated) await openCatalog(controller.signal)
      })
      .catch((caught: unknown) => { if (!controller.signal.aborted) showError(caught) })
      .finally(() => { if (!controller.signal.aborted) { setChecking(false); setBusy(false); setMessage('') } })
    return () => {
      controller.abort()
      controllerRef.current?.abort()
      dialog.close()
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    if (!lockedUntil) return
    const timer = window.setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= lockedUntil) {
        setLockedUntil(0)
        setAttempts(5)
        setError('')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [lockedUntil])

  useEffect(() => {
    if (!busy && days === null && remaining === 0) passwordRef.current?.focus()
  }, [busy, days, remaining])

  useEffect(() => {
    if (days !== null) titleRef.current?.focus()
  }, [days])

  async function unlock(event: React.FormEvent) {
    event.preventDefault()
    if (busy || remaining || !password) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError('')
    setMessage('Opening online data…')
    try {
      await request('login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }), signal: controller.signal,
      })
      setPassword('')
      setAttempts(5)
      await openCatalog(controller.signal)
    } catch (caught) {
      if (!controller.signal.aborted) { showError(caught); setPassword('') }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setMessage('') }
    }
  }

  function toggle(keys: string[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      keys.forEach((id) => checked || loadedIds.has(id) ? next.add(id) : next.delete(id))
      return next
    })
  }

  async function loadSelected() {
    if (!days || busy || !selected.size) return
    if (!newCount) { onClose(); return }
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError('')
    try {
      const sources: Source[] = []
      for (const day of days) {
        for (const file of day.files) {
          const id = key(day.name, file.name)
          if (!selected.has(id) || loadedIds.has(id)) continue
          setMessage(`Downloading ${sources.length + 1}/${newCount} · ${file.name}`)
          const query = new URLSearchParams({ day: day.name, name: file.name })
          const response = await request(`file?${query}`, { signal: controller.signal })
          sources.push({ id, name: file.name, folder: day.name, buffer: await response.arrayBuffer() })
        }
      }
      if (controller.signal.aborted) return
      setMessage('Loading selected CSVs…')
      await onLoad(sources)
      if (!controller.signal.aborted) onClose()
    } catch (caught) {
      if (!controller.signal.aborted) showError(caught)
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setMessage('') }
    }
  }

  async function uploadCsvs() {
    if (busy || !uploads.length) return
    const destinations = uploads.map((item) => ({ ...item, day: item.day.trim(), name: normalizeCsvName(item.name) }))
    if (destinations.some((item) => !item.day || !item.name)) {
      setError('Every upload needs a testing date and CSV filename.')
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setError('')
    try {
      for (let index = 0; index < destinations.length; index++) {
        const item = destinations[index]
        setMessage(`Uploading ${index + 1}/${destinations.length} · ${item.name}`)
        const query = new URLSearchParams({ day: item.day, name: item.name })
        await request(`upload?${query}`, {
          method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: item.file, signal: controller.signal,
        })
      }
      if (uploadRef.current) uploadRef.current.value = ''
      setUploads([])
      await openCatalog(controller.signal)
      setMessage(`${destinations.length} ${destinations.length === 1 ? 'CSV' : 'CSVs'} uploaded.`)
    } catch (caught) {
      if (!controller.signal.aborted) showError(caught)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="online-dialog" aria-labelledby="online-title"
      onCancel={(event) => { event.preventDefault(); onClose() }} onKeyDown={(event) => event.stopPropagation()}>
      <div className="online-heading">
        <div>
          <div className="kicker">ERPL telemetry</div>
          <h2 ref={titleRef} id="online-title" tabIndex={-1}>{days === null ? 'Open Online ERPL Data' : 'Choose test data'}</h2>
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label="Close online data">✕</button>
      </div>
      {checking ? null : days === null ? (
        <form onSubmit={(event) => void unlock(event)}>
          <p className="hint">Enter the shared ERPL password to browse testing days and CSV files.</p>
          <label className="online-password-label" htmlFor="online-password">Password</label>
          <input ref={passwordRef} id="online-password" type="password" autoComplete="current-password"
            value={password} maxLength={1024} required disabled={busy || remaining > 0}
            aria-describedby="online-attempts" onChange={(event) => setPassword(event.target.value)} />
          <p id="online-attempts" className="hint">
            {remaining > 0
              ? `Try again in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}.`
              : `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} remaining. Five incorrect passwords lock access for 5 minutes.`}
          </p>
          {error && <p className="online-error" role="alert">{error}</p>}
          <div className="online-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn accent" disabled={busy || remaining > 0 || !password}>Unlock data</button>
          </div>
        </form>
      ) : (
        <>
          <p className="hint">Select CSV files from one or more testing days. Already open files stay selected; only new files will be added.</p>
          {days.length === 0 ? <p className="empty-lite">No test data has been uploaded yet.</p> : (
            <div className="online-days">
              {days.map((day) => {
                const keys = day.files.map((file) => key(day.name, file.name))
                const count = keys.filter((id) => selected.has(id)).length
                return (
                  <fieldset key={day.name} className="online-day" disabled={busy}>
                    <legend>{day.name}</legend>
                    <label className="online-file online-select-day">
                      <input type="checkbox" checked={count === keys.length}
                        ref={(input) => { if (input) input.indeterminate = count > 0 && count < keys.length }}
                        onChange={(event) => toggle(keys, event.target.checked)} />
                      Select all <span className="count">{day.files.length} CSVs</span>
                    </label>
                    {day.files.map((file) => (
                      <label key={file.name} className="online-file">
                        <input type="checkbox" checked={selected.has(key(day.name, file.name))}
                          disabled={loadedIds.has(key(day.name, file.name))}
                          onChange={(event) => toggle([key(day.name, file.name)], event.target.checked)} />
                        <span>{file.name}</span>
                        {loadedIds.has(key(day.name, file.name)) && <span className="count">Already open</span>}
                      </label>
                    ))}
                  </fieldset>
                )
              })}
            </div>
          )}
          <fieldset className="online-upload" disabled={busy}>
            <legend>Upload test data</legend>
            <p className="hint">CSV files are stored on the private server disk and appear in the catalog immediately.</p>
            <div className="online-upload-fields">
              <label>Default testing date
                <input type="date" value={uploadDay} onChange={(event) => setUploadDay(event.target.value)} />
              </label>
              <label>Choose CSV files
                <input ref={uploadRef} type="file" accept=".csv,text/csv" multiple onChange={(event) => {
                  const selectedFiles = [...(event.target.files || [])]
                  const batch = `${Date.now()}-${uploads.length}`
                  setUploads((current) => [...current, ...selectedFiles.map((file, index) => ({
                    id: `${batch}-${index}`, file, day: uploadDay, name: file.name,
                  }))])
                  event.target.value = ''
                }} />
              </label>
            </div>
            {uploads.length > 0 && (
              <div className="online-upload-queue" aria-label="Files ready to upload">
                {uploads.map((item) => (
                  <div key={item.id} className="online-upload-row">
                    <label>Date
                      <input type="date" required value={item.day} aria-label={`Testing date for ${item.name}`}
                        onChange={(event) => setUploads((current) => current.map((candidate) =>
                          candidate.id === item.id ? { ...candidate, day: event.target.value } : candidate))} />
                    </label>
                    <label>Filename
                      <input type="text" required value={item.name} aria-label={`Filename for ${item.file.name}`}
                        onChange={(event) => setUploads((current) => current.map((candidate) =>
                          candidate.id === item.id ? { ...candidate, name: event.target.value } : candidate))} />
                    </label>
                    <button type="button" className="tiny danger" title={`Remove ${item.file.name} from upload`}
                      aria-label={`Remove ${item.file.name} from upload`}
                      onClick={() => setUploads((current) => current.filter((candidate) => candidate.id !== item.id))}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="online-upload-submit">
              <span className="hint">{uploads.length ? `${uploads.length} ready · edit each destination before uploading` : 'Choose one or more CSV files to begin.'}</span>
              <button type="button" className="btn" disabled={!uploads.length} onClick={() => void uploadCsvs()}>
                Upload{uploads.length ? ` ${uploads.length}` : ''}
              </button>
            </div>
          </fieldset>
          {error && <p className="online-error" role="alert">{error}</p>}
          <div className="online-actions">
            <span className="hint">{selected.size} selected · {newCount} new</span>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn accent" disabled={busy || !selected.size}
              onClick={() => void loadSelected()}>{selected.size > 0 && !newCount ? 'Done' : 'Load selected data'}</button>
          </div>
        </>
      )}
      <div className="online-status" role="status">{message}</div>
    </dialog>
  )
}
