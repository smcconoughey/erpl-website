import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './training.css'

type TrainingNode = {
  id: string; parentId: string | null; title: string; kind: 'folder' | 'markdown' | 'workbook'; version: number;
  status?: string; owner?: string; approver?: string; reviewedOn?: string; reviewDue?: string; updatedAt?: string;
  content?: string; history?: TrainingNode[];
}
type Sheet = { name: string; rows: string[][]; rowCount: number; columnCount: number }
const labels: Record<string, string> = { template: 'Template', draft: 'Draft', 'in-review': 'In review', approved: 'Approved', archived: 'Archived' }
const api = '/api/training'
const jsonBody = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const icon = (node: TrainingNode) => node.kind === 'folder' ? '▱' : node.kind === 'workbook' ? '▦' : '≡'

export function TrainingApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [nodes, setNodes] = useState<TrainingNode[]>([])
  const [selectedId, setSelectedId] = useState(new URLSearchParams(location.search).get('doc') || 'getting-started')
  const [document, setDocument] = useState<TrainingNode | null>(null)
  const [draft, setDraft] = useState<TrainingNode | null>(null)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [revision, setRevision] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const [closed, setClosed] = useState(new Set<string>())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [preview, setPreview] = useState(false)
  const [notice, setNotice] = useState('')
  const [create, setCreate] = useState<'markdown' | 'folder' | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const request = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${api}/${path}`, { credentials: 'same-origin', cache: 'no-store', ...options })
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('login')) { setAuthenticated(false); setNodes([]); setDocument(null); setDraft(null); setSheets([]) }
      const result = await response.json().catch(() => ({ error: 'The server could not complete this request.' }))
      throw new Error(result.error || 'Request failed.')
    }
    return response
  }, [])
  const loadCatalog = useCallback(async () => {
    const data = await (await request('catalog')).json() as { nodes: TrainingNode[] }
    setNodes(data.nodes)
    return data.nodes
  }, [request])
  useEffect(() => {
    window.document.title = 'Safety & Training | ERPL'
    request('status').then((response) => response.json()).then((status) => {
      setAuthenticated(status.authenticated); if (status.authenticated) void loadCatalog().catch((caught) => setError(caught.message))
    }).catch((caught) => { setAuthenticated(false); setError(caught.message) })
  }, [loadCatalog, request])
  useEffect(() => {
    if (!authenticated) return
    const controller = new AbortController()
    setLoading(true); setDocument(null); setSheets([]); setSheetIndex(0); setError('')
    const query = revision ? `?version=${revision}` : ''
    request(`document/${encodeURIComponent(selectedId)}${query}`, { signal: controller.signal })
      .then((response) => response.json()).then(async (data: { document: TrainingNode }) => {
        if (controller.signal.aborted) return
        setDocument(data.document)
        if (data.document.kind === 'workbook') {
          const result = await (await request(`preview/${encodeURIComponent(selectedId)}${query}`, { signal: controller.signal })).json()
          if (!controller.signal.aborted) setSheets(result.sheets)
        }
      }).catch((caught) => { if (!controller.signal.aborted) setError(caught.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [authenticated, selectedId, revision, nodes, request])
  useEffect(() => {
    if (!draft) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draft])
  useEffect(() => {
    if (!create) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setCreate(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [create, busy])
  const select = (id: string, version?: number) => {
    if (draft && !window.confirm('Discard your unsaved changes?')) return
    setDraft(null); setSelectedId(id); setRevision(version); setShowHistory(false); setMobileNav(false); setNotice('')
    const url = new URL(location.href); url.searchParams.set('doc', id); window.history.replaceState(null, '', url)
  }
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  const login = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => { await request('login', { method: 'POST', ...jsonBody({ password }) }); setPassword(''); setAuthenticated(true); await loadCatalog() })
  }
  const active = nodes.find((node) => node.id === selectedId)
  const targetFolder = active?.kind === 'folder' ? active.id : active?.parentId ?? null
  const save = () => void run(async () => {
    if (!draft) return
    await request(`document/${draft.id}`, { method: 'PATCH', ...jsonBody(draft) })
    setDraft(null); setRevision(undefined); await loadCatalog(); setNotice('Saved to the shared workspace.')
  })
  const add = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const result = await (await request('document', { method: 'POST', ...jsonBody({ kind: create, title: newTitle, parentId: targetFolder }) })).json()
      setCreate(null); setNewTitle(''); await loadCatalog(); select(result.document.id)
    })
  }
  const upload = (files: File[], replace = false) => void run(async () => {
    if (draft && !window.confirm('Discard unsaved changes and upload this file?')) return
    setDraft(null)
    let lastId = selectedId
    for (const file of files) {
      if (!/\.(md|xlsx)$/i.test(file.name)) throw new Error('Choose Markdown (.md) or Excel (.xlsx) files.')
      if (file.size > 10 * 1024 * 1024) throw new Error('Files are limited to 10 MB each.')
      const params = new URLSearchParams({ name: file.name })
      if (replace && document) { params.set('id', document.id); params.set('version', String(document.version)) }
      else if (targetFolder) params.set('parentId', targetFolder)
      const result = await (await request(`upload?${params}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file })).json()
      lastId = result.document.id
    }
    await loadCatalog(); select(lastId); setNotice('Upload saved. New and replaced documents are drafts.')
  })
  const startEdit = () => {
    if (!document || revision) return
    setPreview(false)
    setDraft({ ...document, status: document.status === 'approved' ? 'draft' : document.status, approver: '', reviewedOn: '' })
  }
  const folders = nodes.filter((node) => node.kind === 'folder')
  const ancestors = (id: string): TrainingNode[] => {
    const result: TrainingNode[] = []; let node = nodes.find((item) => item.id === id)
    while (node?.parentId) { node = nodes.find((item) => item.id === node!.parentId); if (node) result.unshift(node) }
    return result
  }
  const safeParents = folders.filter((folder) => folder.id !== selectedId && !ancestors(folder.id).some((ancestor) => ancestor.id === selectedId))
  const children = (id: string | null) => nodes.filter((node) => node.parentId === id).sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.title.localeCompare(b.title))
  const matching = nodes.filter((node) => node.title.toLowerCase().includes(search.toLowerCase()) || node.owner?.toLowerCase().includes(search.toLowerCase()))
  const tree = (id: string | null, depth = 0): React.ReactNode => children(id).map((node) => <div key={node.id}>
    <div className={`tr-tree-row ${node.id === selectedId ? 'active' : ''}`} style={{ paddingLeft: 12 + depth * 15 }}>
      {node.kind === 'folder' ? <button className="tr-expand" aria-label={`${closed.has(node.id) ? 'Expand' : 'Collapse'} ${node.title}`} aria-expanded={!closed.has(node.id)} onClick={() => setClosed((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}>{closed.has(node.id) ? '›' : '⌄'}</button> : <span className="tr-expand" />}
      <button className="tr-tree-link" onClick={() => select(node.id)} aria-current={node.id === selectedId ? 'page' : undefined}><span className={`tr-file-icon ${node.kind}`}>{icon(node)}</span><span>{node.title}</span>{node.kind !== 'folder' && node.status !== 'approved' ? <i title={labels[node.status || 'draft']} /> : null}</button>
    </div>
    {node.kind === 'folder' && !closed.has(node.id) ? tree(node.id, depth + 1) : null}
  </div>)
  const badge = (node: TrainingNode) => node.kind !== 'folder' ? <span className={`tr-badge ${node.status}`}>{labels[node.status || 'draft']}</span> : null
  const fileUrl = document ? `${api}/file/${document.id}${revision ? `?version=${revision}` : ''}` : ''
  const today = new Date().toISOString().slice(0, 10)
  const documents = nodes.filter((node) => node.kind !== 'folder')
  const needsReview = documents.filter((node) => node.status !== 'archived' && node.reviewDue && node.reviewDue <= today)
  const docList = (list: TrainingNode[]) => <div className="tr-document-list">{list.map((node) => <button key={node.id} onClick={() => select(node.id)}><span className={`tr-file-icon ${node.kind}`}>{icon(node)}</span><span><strong>{node.title}</strong><small>{node.owner || 'Owner not assigned'}{node.updatedAt ? ` · Updated ${node.updatedAt.slice(0, 10)}` : ''}</small></span>{badge(node)}</button>)}</div>

  if (authenticated !== true) return <div className="tr-gate"><form onSubmit={login} className="tr-gate-card">
    <img src="/erpl-mark.png" alt="ERPL" /><span className="tr-eyebrow">ERPL TEAM WORKSPACE</span>
    <h1>Safety & training</h1><p>Training records, qualifications, procedures, and risk reviews in one shared workspace.</p>
    <label>Workspace password<input type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || authenticated === null} /></label>
    {error ? <p className="tr-error" role="alert">{error}</p> : null}
    <button className="tr-primary" disabled={busy || authenticated === null || !password}>{authenticated === null ? 'Checking access…' : busy ? 'Unlocking…' : 'Open workspace →'}</button><a href="/">Return to data viewer</a>
  </form></div>

  return <div className="tr-app">
    <header className="tr-header" inert={!!create}><button className="tr-mobile-button" onClick={() => setMobileNav((value) => !value)} aria-label="Toggle document navigation">☰</button>
      <a className="tr-brand" href="/training"><img src="/erpl-mark.png" alt="ERPL" /><span>Safety & training<small>Experimental Rocket Propulsion Lab</small></span></a>
      <div className="tr-header-links"><a href="/">Data viewer</a><a href="/library">Engineering Brain</a><button disabled={busy} onClick={() => { if (draft && !window.confirm('Discard unsaved changes and lock the workspace?')) return; void run(async () => { await request('logout', { method: 'POST', ...jsonBody({}) }); setAuthenticated(false); setNodes([]); setDocument(null); setDraft(null); setSheets([]) }) }}>Lock workspace</button></div>
    </header>
    <div className="tr-layout" inert={!!create}><aside className={`tr-sidebar ${mobileNav ? 'open' : ''}`} aria-label="Document navigation">
      <label className="tr-search"><span>⌕</span><input aria-label="Search documents" placeholder="Find a document or owner…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="tr-sidebar-title">WORKSPACE <span>{documents.length} documents</span></div>
      <nav className="tr-tree" aria-label="Training documents">{search ? matching.map((node) => <button className="tr-search-result" key={node.id} onClick={() => { select(node.id); setSearch('') }}>{icon(node)} {node.title}</button>) : tree(null)}{search && !matching.length ? <p className="tr-empty">No matching documents.</p> : null}</nav>
      <div className="tr-sidebar-actions"><button disabled={busy || !!draft} onClick={() => { setCreate('markdown'); setNewTitle('') }}>＋ New page</button><button disabled={busy || !!draft} onClick={() => { setCreate('folder'); setNewTitle('') }}>＋ Folder</button></div>
      <div className="tr-templates"><span className="tr-sidebar-title">BLANK EXCEL TEMPLATES</span><a href={`${api}/template/qualifications`}>▦ Training & authorization registers ↗</a><a href={`${api}/template/fmea`}>▦ FMEA workbook ↗</a><a href={`${api}/template/inspections`}>▦ Inspection & audit log ↗</a></div>
    </aside>
    <main className="tr-main">
      <div className="tr-breadcrumb"><button onClick={() => select('getting-started')}>Workspace</button>{ancestors(selectedId).map((folder) => <span key={folder.id}>/ <button onClick={() => select(folder.id)}>{folder.title}</button></span>)}<span>/ {active?.title || 'Document'}</span></div>
      <div className="tr-page-toolbar"><span className="tr-eyebrow">{document?.kind === 'folder' ? 'DOCUMENT COLLECTION' : document?.kind === 'workbook' ? 'EXCEL WORKBOOK' : 'WORKSPACE DOCUMENT'}</span>
        <div><label className={`tr-button ${busy || !!draft ? 'disabled' : ''}`}>↑ Upload files<input className="tr-upload-input" type="file" multiple accept=".md,.xlsx" aria-label="Upload Markdown or Excel files" disabled={busy || !!draft} onChange={(event) => { const files = [...event.target.files || []]; event.target.value = ''; if (files.length) upload(files) }} /></label>
          {document && document.kind !== 'folder' ? <a className="tr-button" href={fileUrl}>Download</a> : null}
          {document?.history?.length ? <button onClick={() => setShowHistory((value) => !value)} disabled={!!draft}>History</button> : null}
          {document && !draft && !revision ? <button className="tr-primary" onClick={startEdit} disabled={busy}>Edit {document.kind === 'folder' ? 'folder' : 'document'}</button> : null}</div>
      </div>
      {error ? <div className="tr-error" role="alert">{error}</div> : null}{notice ? <div className="tr-notice" role="status">{notice}</div> : null}
      {loading ? <div className="tr-loading">Opening document…</div> : null}
      {revision ? <div className="tr-warning">Viewing revision {revision}. <button onClick={() => select(selectedId)}>Return to current revision</button></div> : null}
      {showHistory && document ? <section className="tr-history"><h2>Revision history</h2><p>Earlier content and files remain available. Reviewer names are recorded metadata, not verified identities.</p>{[document, ...[...document.history || []].reverse()].map((entry) => <button key={entry.version} onClick={() => select(selectedId, entry.version === active?.version ? undefined : entry.version)}>Revision {entry.version} · {entry.updatedAt?.slice(0, 16).replace('T', ' ') || 'Starter template'} {badge(entry)}<span>Open →</span></button>)}</section> : null}
      {draft ? <section className="tr-editor">
        <div className="tr-editor-head"><h1>{draft.kind === 'folder' ? 'Organize folder' : 'Edit document'}</h1><div><button disabled={busy} onClick={() => { if (window.confirm('Discard your unsaved changes?')) setDraft(null) }}>Cancel</button><button className="tr-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button></div></div>
        {document?.status === 'approved' ? <p className="tr-warning">Editing an approved document returns it to draft. Record a fresh review to approve the new revision.</p> : null}
        <div className="tr-details"><label className="tr-wide">Title<input value={draft.title} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="tr-wide">Folder<select value={draft.parentId || ''} onChange={(event) => setDraft({ ...draft, parentId: event.target.value || null })}><option value="">Workspace root</option>{safeParents.map((folder) => <option key={folder.id} value={folder.id}>{[...ancestors(folder.id).map((node) => node.title), folder.title].join(' / ')}</option>)}</select></label>
          {draft.kind !== 'folder' ? <><label>Owner<input value={draft.owner || ''} maxLength={200} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="Responsible person / role" /></label><label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Next review<input type="date" value={draft.reviewDue || ''} onChange={(event) => setDraft({ ...draft, reviewDue: event.target.value })} /></label>
          {draft.status === 'approved' ? <><label>Reviewer<input value={draft.approver || ''} maxLength={200} onChange={(event) => setDraft({ ...draft, approver: event.target.value })} /></label><label>Reviewed on<input type="date" max={today} value={draft.reviewedOn || ''} onChange={(event) => setDraft({ ...draft, reviewedOn: event.target.value })} /></label></> : null}</> : null}
        </div>
        {draft.kind === 'markdown' ? <><div className="tr-editor-tabs"><button aria-pressed={!preview} onClick={() => setPreview(false)}>Markdown</button><button aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button><small>Headings, links, lists, and tables</small></div>{preview ? <article className="tr-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content || ''}</ReactMarkdown></article> : <textarea className="tr-source" aria-label="Markdown content" value={draft.content || ''} onChange={(event) => setDraft({ ...draft, content: event.target.value })} spellCheck={false} />}</> : null}
        {draft.kind === 'workbook' ? <p>Save document details here. To edit workbook cells, download the file, edit in Excel, then use Replace workbook.</p> : null}
      </section> : document && !loading ? <>
        <div className="tr-document-heading"><h1>{document.title}</h1><div className="tr-metadata">{badge(document)}<span>Revision {document.version}</span><span>{document.owner || 'Owner not assigned'}</span>{document.updatedAt ? <span>Updated {document.updatedAt.slice(0, 10)}</span> : null}</div>
          {document.reviewDue ? <div className={document.reviewDue <= today ? 'tr-overdue' : 'tr-review-date'}>Review due {document.reviewDue}</div> : null}
          {document.status === 'approved' ? <p className="tr-review-date">Reviewed by {document.approver} on {document.reviewedOn}. Document review does not establish personnel authorization.</p> : null}
        </div>
        {document.id === 'getting-started' ? <section className="tr-home-overview"><div className="tr-stats"><div><strong>{documents.filter((node) => node.status === 'approved').length}</strong><span>Approved documents</span></div><div><strong>{documents.filter((node) => node.status === 'template').length}</strong><span>Templates to complete</span></div><div><strong>{needsReview.length}</strong><span>Reviews due</span></div></div><div className="tr-warning">This workspace starts with templates and blank registers. No completed training or authorized personnel are recorded by the starter content.</div>{needsReview.length ? <><h2>Review due</h2>{docList(needsReview)}</> : null}<h2>Workspace collections</h2><div className="tr-collections">{folders.filter((folder) => !folder.parentId).map((folder) => <button key={folder.id} onClick={() => select(folder.id)}><span>▱</span><strong>{folder.title}</strong><small>{children(folder.id).length} items</small><em>→</em></button>)}</div></section> : null}
        {document.status !== 'approved' && document.kind !== 'folder' && document.id !== 'getting-started' ? <div className="tr-warning">{document.status === 'archived' ? 'Archived reference. Use the current reviewed revision for operations.' : `${labels[document.status || 'draft']} • not an approved operational document or evidence of qualification.`}</div> : null}
        {document.kind === 'markdown' ? <article className="tr-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: ({ children }) => <h2>{children}</h2>, a: ({ href, children }) => <a href={href} target={href?.startsWith('https:') ? '_blank' : undefined} rel="noopener noreferrer">{children}</a> }}>{document.content || ''}</ReactMarkdown></article> : null}
        {document.kind === 'folder' ? <section className="tr-folder-content"><p>Add pages, subfolders, or upload Markdown and Excel files to this collection.</p>{children(document.id).length ? docList(children(document.id)) : <div className="tr-empty">This folder is empty. Create a page or upload an existing file to get started.</div>}</section> : null}
        {document.kind === 'workbook' ? <section className="tr-workbook"><div className="tr-workbook-toolbar"><div className="tr-sheet-tabs">{sheets.map((sheet, index) => <button key={sheet.name} aria-pressed={sheetIndex === index} onClick={() => setSheetIndex(index)}>{sheet.name}</button>)}</div>{!revision ? <label className={`tr-button ${busy ? 'disabled' : ''}`}>Replace workbook<input className="tr-upload-input" type="file" accept=".xlsx" aria-label="Replace workbook" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload([file], true) }} /></label> : null}</div>{sheets[sheetIndex] ? <><p className="tr-table-note">{sheets[sheetIndex].rowCount} rows · {sheets[sheetIndex].columnCount} columns. Preview shows up to 100 rows and 40 columns per sheet, across the first 30 sheets. Formulas display cached values. Download to edit in Excel.</p><div className="tr-table-scroll"><table><tbody>{sheets[sheetIndex].rows.map((row, i) => <tr key={i}><th>{i + 1}</th>{row.map((cell, j) => i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table>{!sheets[sheetIndex].rows.length ? <p>This sheet is empty.</p> : null}</div></> : <p>No worksheet preview is available.</p>}</section> : null}
      </> : null}
    </main></div>
    {create ? <div className="tr-modal-backdrop"><form className="tr-modal" onSubmit={add} role="dialog" aria-modal="true" aria-labelledby="tr-create-title"><h2 id="tr-create-title">New {create === 'folder' ? 'folder' : 'Markdown page'}</h2><p>In {nodes.find((node) => node.id === targetFolder)?.title || 'Workspace root'}</p><label>Title<input autoFocus required maxLength={160} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /></label>{error ? <p className="tr-error" role="alert">{error}</p> : null}<div className="tr-modal-actions"><button type="button" onClick={() => setCreate(null)} disabled={busy}>Cancel</button><button className="tr-primary" disabled={busy || !newTitle.trim()}>{busy ? 'Creating…' : 'Create'}</button></div></form></div> : null}
  </div>
}
