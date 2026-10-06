import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LibraryGraph } from './LibraryGraph'
import { buildPdfGraph } from './pdfGraph'

export type LibraryDocument = {
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
  searchText: string
  links: string[]
}

type SearchResult = { path: string; page: number; kind: string; excerpt: string; score: number }

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
  const [selectedPath, setSelectedPath] = useState(() => decodeURIComponent(location.hash.slice(1)))
  const [readerOpen, setReaderOpen] = useState(() => Boolean(location.hash.slice(1)))
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchIndexed, setSearchIndexed] = useState<boolean | null>(null)
  const [graphSelectedPath, setGraphSelectedPath] = useState('')
  const [activeTopicPath, setActiveTopicPath] = useState('')
  const [selectedPage, setSelectedPage] = useState<number>()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const response = await request('catalog')
    const data = await response.json() as { documents: LibraryDocument[] }
    setDocuments(data.documents)
    setAuthenticated(true)
  }

  useEffect(() => {
    request('status').then((response) => response.json()).then((data: { authenticated: boolean }) => {
      setAuthenticated(data.authenticated)
      if (data.authenticated) return load()
    }).catch((caught: ApiError) => { setError(caught.message); setAuthenticated(false) })
  }, [])

  useEffect(() => {
    history.replaceState(null, '', readerOpen && selectedPath ? `/library#${encodeURIComponent(selectedPath)}` : '/library')
  }, [readerOpen, selectedPath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (readerOpen) setReaderOpen(false)
        else setSearch('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [readerOpen])

  useEffect(() => {
    const query = search.trim()
    if (query.length < 2 || authenticated !== true) {
      setSearchResults([]); setSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      request(`search?${new URLSearchParams({ q: query })}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data: { indexed: boolean; results: SearchResult[] }) => {
          setSearchResults(data.results || []); setSearchIndexed(data.indexed)
        })
        .catch((caught) => { if (caught.name !== 'AbortError') setSearchResults([]) })
        .finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [authenticated, search])

  const selected = documents.find((document) => document.path === selectedPath) || null
  const graph = useMemo(() => buildPdfGraph(documents), [documents])
  const activeTopic = graph.topics.find((document) => document.path === activeTopicPath)
  const topicConnections = useMemo(() => {
    const paths = new Set(graph.edges.flatMap((edge) => edge.source === activeTopicPath ? [edge.target] : edge.target === activeTopicPath ? [edge.source] : []))
    return graph.nodes.filter((document) => paths.has(document.path)).sort((a, b) =>
      (a.kind === 'pdf' ? 1 : 0) - (b.kind === 'pdf' ? 1 : 0) || a.title.localeCompare(b.title, undefined, { numeric: true }))
  }, [graph, activeTopicPath])
  const passagesByPath = useMemo(() => {
    const result = new Map<string, SearchResult[]>()
    searchResults.forEach((hit) => result.set(hit.path, [...result.get(hit.path) || [], hit]))
    return result
  }, [searchResults])
  const matchedPaths = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const paths = new Set(searchResults.map((result) => result.path))
    if (!terms.length) documents.forEach((document) => paths.add(document.path))
    else documents.forEach((document) => {
      const haystack = `${document.title} ${document.path} ${document.category} ${document.notes} ${document.searchText || ''}`.toLowerCase()
      if (terms.every((term) => haystack.includes(term))) paths.add(document.path)
    })
    return paths
  }, [documents, search, searchResults])
  const filtered = useMemo(() => documents.filter((document) => matchedPaths.has(document.path)).sort((a, b) =>
    (passagesByPath.get(b.path)?.[0]?.score || 0) - (passagesByPath.get(a.path)?.[0]?.score || 0) || a.title.localeCompare(b.title)
  ), [documents, matchedPaths, passagesByPath])
  const openDocument = (path: string, page?: number) => {
    setSelectedPath(path); setGraphSelectedPath(path); setSelectedPage(page); setReaderOpen(true)
  }

  if (authenticated !== true) {
    return <LibraryLogin loading={authenticated === null} error={error} onAuthenticated={() => void load().catch((caught) => setError(caught.message))} />
  }

  return (
    <div className="library-app library-graph-app">
      <header className="library-header">
        <a className="library-brand" href="/library">
          <img src={`${import.meta.env.BASE_URL}erpl-mark.png`} alt="ERPL" />
          <span><strong>Engineering Brain</strong><small>ERPL knowledge library</small></span>
        </a>
        <div className="library-search-wrap">
          <label className="library-search">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search documents and PDF passages" aria-label="Search library" />
            {search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button> : null}
          </label>
          {search.trim() ? <div className="library-search-results">
            <div className="library-search-results-head">{searching ? 'Searching full text…' : `${filtered.length} matching document${filtered.length === 1 ? '' : 's'}${searchResults.length ? ` · ${searchResults.length} passage hits` : ''}${searchIndexed === false ? ' · PDF index unavailable' : ''}`}</div>
            <div className="library-search-results-list">
              {filtered.slice(0, 60).map((document) => <button type="button" key={document.path} onClick={() => { openDocument(document.path, passagesByPath.get(document.path)?.[0]?.page); setSearch('') }}>
                <DocumentIcon kind={document.kind} /><span><strong>{document.title}</strong><small>{document.path}</small>
                  {passagesByPath.get(document.path)?.[0] ? <SearchExcerpt hit={passagesByPath.get(document.path)![0]} count={passagesByPath.get(document.path)!.length} /> : null}
                </span>
              </button>)}
              {!filtered.length && !searching ? <p>No matching documents. Try another term.</p> : null}
            </div>
          </div> : null}
        </div>
        <div className="library-header-actions">
          <a className="btn" href="/">Telemetry</a>
          <a className="btn" href="/training">Training</a>
          <button type="button" className="btn accent" onClick={() => setUploadOpen(true)}>＋ Add to library</button>
        </div>
      </header>
      {error ? <div className="banner">{error}</div> : null}
      <main className="library-graph-stage"><LibraryGraph documents={documents} matchedPaths={matchedPaths} query={search}
        selectedPath={graphSelectedPath} onSelect={(path) => { setGraphSelectedPath(path); if (path.startsWith('Topics/')) setActiveTopicPath(path) }}
        onOpen={(path) => { if (path.startsWith('Topics/')) { setGraphSelectedPath(path); setActiveTopicPath(path) } else openDocument(path) }} />
        {activeTopic ? <aside className="library-topic-panel" role="dialog" aria-label={`${activeTopic.title} connected documents`}>
          <div className="library-topic-panel-head"><span className="kicker">Topic connections</span><button type="button" aria-label="Close topic panel" onClick={() => { setActiveTopicPath(''); setGraphSelectedPath('') }}>×</button></div>
          <h2>{activeTopic.title}</h2>
          <p>{topicConnections.length} connected document{topicConnections.length === 1 ? '' : 's'}</p>
          <button type="button" className="btn compact library-topic-open" onClick={() => openDocument(activeTopic.path)}>Open topic note</button>
          <div className="library-topic-list">
            {topicConnections.map((document) => <button type="button" key={document.path} onClick={() => document.path.startsWith('Topics/') ? (setActiveTopicPath(document.path), setGraphSelectedPath(document.path)) : openDocument(document.path)}>
              <DocumentIcon kind={document.kind} /><span><strong>{document.title}</strong><small>{document.kind === 'pdf' ? 'PDF source' : 'Related topic'}</small></span>
            </button>)}
          </div>
        </aside> : null}
      </main>
      {readerOpen && selected ? <div className="library-pdf-overlay">
        <div className="library-pdf-toolbar"><button type="button" className="btn" onClick={() => setReaderOpen(false)}>← Back to graph</button><span>{selected.title}</span></div>
        <main className="library-reader"><DocumentReader document={selected} documents={documents} page={selectedPage}
          onNavigate={(path) => openDocument(path)} onUpdated={() => void load().catch((caught) => setError(caught.message))} /></main>
      </div> : null}
      {uploadOpen ? <UploadDialog topics={graph.topics} categories={[...new Set(documents.map((document) => document.category))].sort()} onClose={() => setUploadOpen(false)} onCreated={load} onUploaded={async () => { await load(); setUploadOpen(false) }} /> : null}
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

function SearchExcerpt({ hit, count }: { hit: SearchResult; count: number }) {
  const parts = hit.excerpt.split(/(<mark>.*?<\/mark>)/gi)
  return <span className="library-search-hit">
    <span>{parts.map((part, index) => /^<mark>/i.test(part) ? <mark key={index}>{part.replace(/<\/?mark>/gi, '')}</mark> : part)}</span>
    <em>{hit.page > 0 ? `p. ${hit.page}` : hit.kind}{count > 1 ? ` · ${count} hits` : ''}</em>
  </span>
}

function DocumentReader({ document, documents, page, onNavigate, onUpdated }: {
  document: LibraryDocument; documents: LibraryDocument[]; page?: number; onNavigate: (path: string) => void; onUpdated: () => void
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
    const clean = decodeURIComponent(target.replace(/^wiki:/, '')).split('#')[0].toLowerCase()
    const found = documents.find((item) => item.path.toLowerCase() === clean || item.path.replace(/\.[^.]+$/, '').toLowerCase() === clean)
      || documents.find((item) => item.kind === 'markdown' && (item.title.toLowerCase() === clean || item.name.replace(/\.[^.]+$/, '').toLowerCase() === clean))
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
      {document.kind === 'pdf' ? <iframe title={document.title} src={`${fileUrl(document)}${page ? `#page=${page}` : ''}`} /> : null}
      {document.kind === 'image' ? <img src={fileUrl(document)} alt={document.title} /> : null}
      {document.kind === 'audio' ? <audio controls src={fileUrl(document)} /> : null}
      {document.kind === 'video' ? <video controls src={fileUrl(document)} /> : null}
      {document.kind === 'file' ? <div className="library-empty reader"><DocumentIcon kind="file" /><strong>Preview unavailable</strong><span>{document.mime} · {formatBytes(document.size)}</span><a className="btn accent" href={fileUrl(document, true)}>Download file</a></div> : null}
    </div>
  </>
}

function UploadDialog({ topics, categories, onClose, onCreated, onUploaded }: {
  topics: LibraryDocument[]; categories: string[]; onClose: () => void; onCreated: () => Promise<void>; onUploaded: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [category, setCategory] = useState('Inbox')
  const [newCategory, setNewCategory] = useState('')
  const [selectedTopics, setSelectedTopics] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); folderRef.current?.setAttribute('directory', '') }, [])
  const createCategory = async () => {
    setBusy(true); setError('')
    try {
      const response = await request('topic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newCategory }) })
      const data = await response.json() as { topic: { path: string; title: string } }
      setSelectedTopics((paths) => [...new Set([...paths, data.topic.path])])
      setCategory(data.topic.title)
      setNewCategory('')
      await onCreated()
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  const upload = async () => {
    setBusy(true); setError('')
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        setProgress(`Uploading ${index + 1} of ${files.length} · ${relativePath}`)
        const query = new URLSearchParams({ path: relativePath, category, ...(notes ? { notes } : {}) })
        if (file.name.toLowerCase().endsWith('.pdf')) selectedTopics.forEach((topic) => query.append('topics', topic))
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
      <label>Library category<input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} list="library-categories" /></label>
      <datalist id="library-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
      <div className="library-upload-topics">
        <div><strong>Connect PDFs to topic nodes</strong><span>Select every topic this upload belongs to. Other file types will not be linked on the graph.</span></div>
        <div className="library-upload-topic-list">{topics.map((topic) => <label key={topic.path}>
          <input type="checkbox" checked={selectedTopics.includes(topic.path)} disabled={busy} onChange={(event) => setSelectedTopics((paths) => event.target.checked ? [...paths, topic.path] : paths.filter((path) => path !== topic.path))} />{topic.title}
        </label>)}</div>
        <div className="library-upload-new-category"><input aria-label="New category name" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={80} placeholder="New category / topic name" disabled={busy} /><button type="button" className="btn" onClick={() => void createCategory()} disabled={busy || !newCategory.trim()}>＋ Create category</button></div>
        <small>Creating a category adds a topic node immediately and selects it for these PDFs.</small>
      </div>
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
