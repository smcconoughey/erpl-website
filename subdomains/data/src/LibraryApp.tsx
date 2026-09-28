import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type LibraryDocument = {
  id: string
  path: string
  name: string
  title: string
  folder: string
  category: string
  notes: string
  mime: string
  kind: 'markdown' | 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'file'
  size: number
  uploadedAt: string
  updatedAt: string
}

type ApiError = Error & { status?: number; attemptsRemaining?: number; retryAfter?: number }

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`/api/library/${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; attemptsRemaining?: number; retryAfter?: number }
    throw Object.assign(new Error(body.error || 'The library is temporarily unavailable.'), body, { status: response.status }) as ApiError
  }
  return response
}

const fileUrl = (document: LibraryDocument, download = false) =>
  `/api/library/file?${new URLSearchParams({ path: document.path, ...(download ? { download: '1' } : {}) })}`

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
}

export function LibraryApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [documents, setDocuments] = useState<LibraryDocument[]>([])
  const [totalBytes, setTotalBytes] = useState(0)
  const [selectedPath, setSelectedPath] = useState(() => decodeURIComponent(location.hash.slice(1)))
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [folder, setFolder] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const response = await request('catalog')
    const data = await response.json() as { documents: LibraryDocument[]; totalBytes: number }
    setDocuments(data.documents)
    setTotalBytes(data.totalBytes)
    setAuthenticated(true)
    if (!selectedPath && data.documents.length) setSelectedPath(data.documents.find((item) => item.name.toLowerCase() === 'home.md')?.path || data.documents[0].path)
  }

  useEffect(() => {
    request('status').then((response) => response.json()).then((data: { authenticated: boolean }) => {
      setAuthenticated(data.authenticated)
      if (data.authenticated) return load()
    }).catch((caught: ApiError) => { setError(caught.message); setAuthenticated(false) })
  }, [])

  useEffect(() => {
    if (selectedPath) history.replaceState(null, '', `/library#${encodeURIComponent(selectedPath)}`)
  }, [selectedPath])

  const selected = documents.find((document) => document.path === selectedPath) || null
  const categories = useMemo(() => ['All', ...new Set(documents.map((document) => document.category).filter(Boolean))], [documents])
  const folders = useMemo(() => {
    const values = new Set<string>()
    documents.forEach((document) => {
      const parts = document.folder.split('/').filter(Boolean)
      for (let index = 1; index <= parts.length; index += 1) values.add(parts.slice(0, index).join('/'))
    })
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [documents])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return documents.filter((document) =>
      (category === 'All' || document.category === category) &&
      (!folder || document.path.startsWith(`${folder}/`)) &&
      (!query || `${document.title} ${document.path} ${document.category} ${document.notes}`.toLowerCase().includes(query)))
  }, [documents, search, category, folder])

  if (authenticated !== true) {
    return <LibraryLogin loading={authenticated === null} error={error} onAuthenticated={() => void load().catch((caught) => setError(caught.message))} />
  }

  return (
    <div className="library-app">
      <header className="library-header">
        <a className="library-brand" href="/library">
          <img src={`${import.meta.env.BASE_URL}erpl-mark.png`} alt="ERPL" />
          <span><strong>Engineering Brain</strong><small>ERPL knowledge library</small></span>
        </a>
        <label className="library-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, paths, categories, and notes" />
          {search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button> : null}
        </label>
        <div className="library-header-actions">
          <a className="btn" href="/">Telemetry</a>
          <button type="button" className="btn accent" onClick={() => setUploadOpen(true)}>＋ Add to library</button>
        </div>
      </header>
      {error ? <div className="banner">{error}</div> : null}
      <div className="library-workspace">
        <aside className="library-nav">
          <div className="library-nav-head"><span className="kicker">Vault</span><span>{documents.length} docs</span></div>
          <button type="button" className={`library-nav-row${folder === '' ? ' active' : ''}`} onClick={() => setFolder('')}>
            <span>◇</span><strong>All documents</strong><em>{documents.length}</em>
          </button>
          <div className="library-section-label">Folders</div>
          <div className="library-folder-list">
            {folders.map((name) => <button type="button" key={name} className={`library-nav-row${folder === name ? ' active' : ''}`}
              style={{ paddingLeft: `${12 + (name.split('/').length - 1) * 13}px` }} onClick={() => setFolder(name)}>
              <span>▱</span><strong>{name.split('/').at(-1)}</strong>
            </button>)}
          </div>
          <div className="library-nav-foot"><span>{formatBytes(totalBytes)} stored</span><span>Protected team library</span></div>
        </aside>

        <section className="library-list-pane">
          <div className="library-list-head">
            <div><span className="kicker">Browse</span><h1>{folder || 'All documents'}</h1></div>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
              {categories.map((name) => <option key={name}>{name}</option>)}
            </select>
          </div>
          <div className="library-results-meta">{filtered.length} result{filtered.length === 1 ? '' : 's'}{search ? ` for “${search}”` : ''}</div>
          <div className="library-document-list">
            {filtered.map((document) => <button type="button" key={document.path}
              className={`library-document-row${selected?.path === document.path ? ' active' : ''}`}
              onClick={() => setSelectedPath(document.path)}>
              <DocumentIcon kind={document.kind} />
              <span className="library-document-main"><strong>{document.title}</strong><small>{document.path}</small></span>
              <span className="library-document-side"><em>{document.category}</em><small>{formatBytes(document.size)}</small></span>
            </button>)}
            {!filtered.length ? <div className="library-empty"><strong>No documents found</strong><span>Try another search, folder, or category.</span></div> : null}
          </div>
        </section>

        <main className="library-reader">
          {selected ? <DocumentReader document={selected} documents={documents} onNavigate={setSelectedPath}
            onUpdated={() => void load().catch((caught) => setError(caught.message))} /> :
            <div className="library-empty reader"><strong>Select a document</strong><span>Choose a note, reference, or attachment from the library.</span></div>}
        </main>
      </div>
      {uploadOpen ? <UploadDialog onClose={() => setUploadOpen(false)} onUploaded={async () => { await load(); setUploadOpen(false) }} /> : null}
    </div>
  )
}

function LibraryLogin({ loading, error, onAuthenticated }: { loading: boolean; error: string; onAuthenticated: () => void }) {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(error)
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      await request('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      onAuthenticated()
    } catch (caught) { setMessage((caught as Error).message) } finally { setBusy(false) }
  }
  return <div className="library-gate">
    <form onSubmit={submit} className="library-gate-card">
      <img src={`${import.meta.env.BASE_URL}erpl-mark.png`} alt="ERPL" />
      <span className="kicker">ERPL team access</span>
      <h1>Engineering Brain</h1>
      <p>Browse the team knowledge vault and contribute new notes, references, and files.</p>
      <label>Shared password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus disabled={loading || busy} /></label>
      {message ? <div className="library-form-error">{message}</div> : null}
      <button className="btn accent" disabled={loading || busy || !password}>{loading ? 'Checking session…' : busy ? 'Unlocking…' : 'Unlock library'}</button>
      <a href="/">Return to telemetry</a>
    </form>
  </div>
}

function DocumentReader({ document, documents, onNavigate, onUpdated }: {
  document: LibraryDocument; documents: LibraryDocument[]; onNavigate: (path: string) => void; onUpdated: () => void
}) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: document.title, category: document.category, notes: document.notes })
  const [error, setError] = useState('')
  useEffect(() => {
    setDraft({ title: document.title, category: document.category, notes: document.notes }); setEditing(false); setError('')
    if (document.kind !== 'markdown' && document.kind !== 'text') return setContent('')
    const controller = new AbortController(); setLoading(true)
    fetch(fileUrl(document), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Unable to preview this document.'); return response.text() })
      .then(setContent).catch((caught) => { if (caught.name !== 'AbortError') setError(caught.message) }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [document.path])

  const save = async () => {
    setError('')
    try {
      await request('document', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: document.path, ...draft }) })
      setEditing(false); onUpdated()
    } catch (caught) { setError((caught as Error).message) }
  }
  const resolveWiki = (target: string) => {
    const clean = decodeURIComponent(target.replace(/^wiki:/, '')).toLowerCase()
    const found = documents.find((item) => item.title.toLowerCase() === clean || item.name.replace(/\.[^.]+$/, '').toLowerCase() === clean || item.path.toLowerCase() === clean)
    if (found) onNavigate(found.path)
  }
  const markdown = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => `[${label || target}](wiki:${encodeURIComponent(target)})`)

  return <>
    <div className="library-reader-head">
      <div><span className="kicker">{document.category}</span><h1>{document.title}</h1><div className="library-path">{document.path}</div></div>
      <div className="library-reader-actions">
        <a className="btn" href={fileUrl(document, true)}>Download</a>
        <button type="button" className="btn" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel' : 'Details'}</button>
      </div>
    </div>
    {editing ? <div className="library-details-form">
      <label>Display title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Category<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
      <label>Team notes<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={5} placeholder="Add context, decisions, or why this document matters…" /></label>
      <button type="button" className="btn accent" onClick={() => void save()}>Save details</button>
    </div> : null}
    {!editing && document.notes ? <div className="library-note"><span>Team note</span>{document.notes}</div> : null}
    {error ? <div className="library-form-error reader-error">{error}</div> : null}
    <div className="library-preview">
      {loading ? <div className="library-empty reader"><span>Loading preview…</span></div> : null}
      {!loading && document.kind === 'markdown' ? <article className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => href?.startsWith('wiki:') ? <button type="button" className="wiki-link" onClick={() => resolveWiki(href)}>{children}</button> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      }}>{markdown}</ReactMarkdown></article> : null}
      {!loading && document.kind === 'text' ? <pre className="text-preview">{content}</pre> : null}
      {document.kind === 'pdf' ? <iframe title={document.title} src={fileUrl(document)} /> : null}
      {document.kind === 'image' ? <img src={fileUrl(document)} alt={document.title} /> : null}
      {document.kind === 'audio' ? <audio controls src={fileUrl(document)} /> : null}
      {document.kind === 'video' ? <video controls src={fileUrl(document)} /> : null}
      {document.kind === 'file' ? <div className="library-empty reader"><DocumentIcon kind="file" /><strong>Preview unavailable</strong><span>{document.mime} · {formatBytes(document.size)}</span><a className="btn accent" href={fileUrl(document, true)}>Download file</a></div> : null}
    </div>
  </>
}

function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [category, setCategory] = useState('Inbox')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); folderRef.current?.setAttribute('directory', '') }, [])
  const upload = async () => {
    setBusy(true); setError('')
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        setProgress(`Uploading ${index + 1} of ${files.length} · ${relativePath}`)
        const query = new URLSearchParams({ path: relativePath, category, ...(notes ? { notes } : {}) })
        await request(`document?${query}`, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
      }
      await onUploaded()
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose() }}>
    <section className="library-upload-modal">
      <div className="modal-head"><div><span className="kicker">Ingestion</span><h2>Add to Engineering Brain</h2></div><button type="button" className="tiny" onClick={onClose} disabled={busy}>×</button></div>
      <p>Upload individual documents or preserve a folder structure. Every item becomes immediately available to authenticated teammates.</p>
      <div className="library-upload-pickers">
        <button type="button" className="btn" onClick={() => filesRef.current?.click()} disabled={busy}>Choose files</button>
        <button type="button" className="btn" onClick={() => folderRef.current?.click()} disabled={busy}>Choose folder</button>
        <span>{files.length ? `${files.length} selected · ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))}` : 'Up to 100 MB per file'}</span>
      </div>
      <label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} /></label>
      <label>Notes applied to this upload<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={4000} placeholder="Source, context, owner, or review notes…" /></label>
      {progress ? <div className="library-upload-progress">{progress}</div> : null}
      {error ? <div className="library-form-error">{error}</div> : null}
      <div className="modal-actions"><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn accent" onClick={() => void upload()} disabled={busy || !files.length}>{busy ? 'Uploading…' : `Upload ${files.length || ''}`}</button></div>
      <input ref={filesRef} type="file" multiple className="hidden" onChange={(event) => setFiles([...event.target.files || []])} />
      <input ref={folderRef} type="file" multiple className="hidden" onChange={(event) => setFiles([...event.target.files || []])} />
    </section>
  </div>
}

function DocumentIcon({ kind }: { kind: LibraryDocument['kind'] }) {
  return <span className={`document-icon ${kind}`}>{kind === 'pdf' ? 'PDF' : kind === 'markdown' ? 'M↓' : kind === 'image' ? '▧' : kind === 'file' ? '◇' : '≡'}</span>
}
