import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp } from './app.mjs'
import { LOCKOUT_MS } from './auth.mjs'

const password = 'test-only-shared-password'
const secret = 'test-only-session-secret-at-least-32-characters'
const ingestToken = 'test-only-machine-ingest-token-at-least-32-characters'
const librarySyncToken = 'test-only-library-sync-token-at-least-32-characters'
const brainLinkToken = 'test-only-brain-link-token-at-least-32-characters'
const csv = 'elapsed_s,pressure (psi)\n0,10\n1,20\n2,15\n3,12\n'

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'erpl-online-'))
  const dataDir = join(directory, 'testdata')
  const distDir = join(directory, 'dist')
  const day = '2026-09-19'
  await mkdir(join(dataDir, day), { recursive: true })
  await mkdir(distDir)
  await writeFile(join(dataDir, day, 'hot fire.csv'), csv)
  await writeFile(join(dataDir, day, 'notes.txt'), 'private notes')
  await writeFile(join(dataDir, day, '.hidden.csv'), 'hidden')
  await writeFile(join(distDir, 'index.html'), '<h1>Datanator</h1>')
  let time = Date.now()
  const settings = { dataDir, distDir, password, secret, ingestToken, librarySyncToken, now: () => time, ...options }
  const servers = []
  const start = async () => {
    const server = createApp(settings).listen(0, '127.0.0.1')
    servers.push(server)
    await once(server, 'listening')
    return `http://127.0.0.1:${server.address().port}`
  }
  const base = await start()
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((done) => { server.close(done); server.closeAllConnections() })))
    await rm(directory, { recursive: true, force: true })
  })
  const login = (value = password, headers = {}, url = base) => fetch(`${url}/api/online/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ password: value }),
  })
  return { base, login, start, dataDir, directory, ingestToken: settings.ingestToken, advance: (ms) => { time += ms } }
}

const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0]

test('catalog and bytes require authentication; only dist is public', async (t) => {
  const { base, login } = await fixture(t)
  for (const path of ['/api/online/catalog', '/api/online/file?day=2026-09-19&name=hot%20fire.csv']) {
    const response = await fetch(base + path)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(!(await response.text()).includes('hot fire'))
  }
  for (const path of ['/testdata/2026-09-19/hot%20fire.csv', '/testdata/.auth/attempts.json', '/.env', '/server/app.mjs']) {
    assert.equal((await fetch(base + path)).status, 404)
  }
  const appPage = await fetch(base)
  assert.equal(appPage.headers.get('x-frame-options'), 'DENY')
  assert.match(await appPage.text(), /Datanator/)
  const loggedIn = await login()
  assert.equal(loggedIn.status, 200)
  assert.match(loggedIn.headers.get('set-cookie'), /HttpOnly/)
  assert.match(loggedIn.headers.get('set-cookie'), /SameSite=Strict/)
  const headers = { Cookie: cookieOf(loggedIn) }
  const catalog = await fetch(`${base}/api/online/catalog`, { headers })
  assert.deepEqual(await catalog.json(), { days: [{ name: '2026-09-19', files: [{ name: 'hot fire.csv' }] }] })
  const file = await fetch(`${base}/api/online/file?day=2026-09-19&name=hot%20fire.csv`, { headers })
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('cache-control'), 'no-store')
  assert.equal(await file.text(), csv)
})

test('NASA CEA rocket solves are authenticated and validated before execution', async (t) => {
  let received
  const result = { solver: 'NASA CEA', version: 'test', converged: true, cf: 1.42 }
  const { base, login } = await fixture(t, { solveCea: async (input) => { received = input; return result } })
  const input = {
    fuel: 'ipa', mode: 'equilibrium', chamberPressurePsi: 300, ofRatio: 1.7,
    expansionRatio: 4, ambientPressurePsi: 14.696, fuelTemperatureK: 293.15,
    oxidizerTemperatureK: 90.17,
  }
  assert.equal((await fetch(`${base}/api/online/cea/rocket`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })).status, 401)
  const headers = { Cookie: cookieOf(await login()), 'Content-Type': 'application/json' }
  const response = await fetch(`${base}/api/online/cea/rocket`, {
    method: 'POST', headers, body: JSON.stringify(input),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { result })
  assert.deepEqual(received, input)
  const invalid = await fetch(`${base}/api/online/cea/rocket`, {
    method: 'POST', headers, body: JSON.stringify({ ...input, chamberPressurePsi: 10 }),
  })
  assert.equal(invalid.status, 422)
  assert.match((await invalid.json()).error, /greater than ambient/)
  assert.equal((await fetch(`${base}/api/online/cea/rocket`, {
    method: 'POST', headers: { Cookie: headers.Cookie, 'Content-Type': 'text/plain' }, body: '{}',
  })).status, 415)
})

test('health check proves the cached NASA CEA solver can converge', async (t) => {
  let solves = 0
  const solveCea = async () => { solves += 1; return { solver: 'NASA CEA', version: '3.3.4', converged: true } }
  const { base } = await fixture(t, { solveCea })
  for (let check = 0; check < 2; check++) {
    const response = await fetch(`${base}/healthz`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true, cea: { solver: 'NASA CEA', version: '3.3.4', converged: true },
    })
  }
  assert.equal(solves, 1)
})

test('fifth failed attempt locks even the correct password for exactly five minutes, including after restart', async (t) => {
  const { base, login, advance, start } = await fixture(t)
  for (let failure = 1; failure <= 4; failure++) {
    const response = await login('wrong')
    assert.equal(response.status, 401)
    assert.equal((await response.json()).attemptsRemaining, 5 - failure)
  }
  const fifth = await login('wrong')
  assert.equal(fifth.status, 429)
  assert.equal(fifth.headers.get('retry-after'), '300')
  assert.equal((await login()).status, 429)
  const status = await fetch(`${base}/api/online/status`)
  assert.equal(status.status, 429)
  const restartedBase = await start()
  assert.equal((await login(password, {}, restartedBase)).status, 429)
  advance(LOCKOUT_MS - 1)
  assert.equal((await login(password, {}, restartedBase)).status, 429)
  advance(1)
  assert.equal((await login(password, {}, restartedBase)).status, 200)
  assert.equal((await (await login('wrong', {}, restartedBase)).json()).attemptsRemaining, 4)
})

test('correct login resets failures; sessions expire and tampering is rejected', async (t) => {
  const { base, login, advance } = await fixture(t)
  await login('wrong')
  const cookie = cookieOf(await login())
  assert.equal((await (await login('wrong')).json()).attemptsRemaining, 4)
  const last = cookie.at(-1)
  const forged = cookie.slice(0, -1) + (last === 'A' ? 'B' : 'A')
  assert.equal((await fetch(`${base}/api/online/catalog`, { headers: { Cookie: forged } })).status, 401)
  advance(60 * 60 * 1000)
  assert.equal((await fetch(`${base}/api/online/catalog`, { headers: { Cookie: cookie } })).status, 401)
})

test('status recognizes a reusable session and returns to password entry when it expires', async (t) => {
  const { base, login, advance } = await fixture(t)
  const status = (headers) => fetch(`${base}/api/online/status`, { headers }).then((response) => response.json())
  assert.deepEqual(await status(), { authenticated: false, attemptsRemaining: 5 })
  const headers = { Cookie: cookieOf(await login()) }
  for (let reopen = 0; reopen < 2; reopen++) {
    assert.deepEqual(await status(headers), { authenticated: true, attemptsRemaining: 5 })
    assert.equal((await fetch(`${base}/api/online/catalog`, { headers })).status, 200)
  }
  // Another unauthenticated visitor on the same IP must not interrupt a valid session.
  for (let i = 0; i < 5; i++) await login('wrong')
  assert.deepEqual(await status(headers), { authenticated: true, attemptsRemaining: 5 })
  advance(60 * 60 * 1000)
  assert.deepEqual(await status(headers), { authenticated: false, attemptsRemaining: 5 })
  assert.equal((await fetch(`${base}/api/online/catalog`, { headers })).status, 401)
})

test('path traversal, non-CSV files, hidden files, and symlink directories cannot be downloaded', async (t) => {
  const { base, login, directory, dataDir } = await fixture(t)
  const headers = { Cookie: cookieOf(await login()) }
  for (const [day, name] of [['..', 'secret.csv'], ['2026-09-19', '../secret.csv'],
    ['2026-09-19', '..\\secret.csv'], ['2026-09-19', '.hidden.csv'], ['2026-09-19', 'notes.txt'],
    ['2026-09-19', 'C:secret.csv'], ['2026-09-19', 'file.csv\0']]) {
    const response = await fetch(`${base}/api/online/file?${new URLSearchParams({ day, name })}`, { headers })
    assert.equal(response.status, 400)
  }
  await mkdir(join(directory, 'outside'))
  await writeFile(join(directory, 'outside', 'secret.csv'), 'secret')
  await symlink(join(directory, 'outside'), join(dataDir, 'linked-day'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await fetch(`${base}/api/online/file?day=linked-day&name=secret.csv`, { headers })).status, 404)
  assert.ok(!JSON.stringify(await (await fetch(`${base}/api/online/catalog`, { headers })).json()).includes('linked-day'))
})

test('authenticated browser uploads are persisted and immediately appear in the catalog', async (t) => {
  const { base, login } = await fixture(t)
  const headers = { Cookie: cookieOf(await login()), 'Content-Type': 'text/csv' }
  const upload = await fetch(`${base}/api/online/upload?${new URLSearchParams({ day: '2026-09-20', name: 'cold flow.csv' })}`, {
    method: 'PUT', headers, body: csv,
  })
  assert.equal(upload.status, 201)
  assert.deepEqual((await upload.json()).file, { day: '2026-09-20', name: 'cold flow.csv', bytes: Buffer.byteLength(csv) })
  const catalog = await fetch(`${base}/api/online/catalog`, { headers })
  assert.deepEqual((await catalog.json()).days[0], { name: '2026-09-20', files: [{ name: 'cold flow.csv' }] })
  assert.equal((await fetch(`${base}/api/online/upload?day=2026-09-20&name=notes.txt`, {
    method: 'PUT', headers, body: csv,
  })).status, 400)
  assert.equal((await fetch(`${base}/api/online/upload?day=2026-09-20&name=other.csv`, {
    method: 'PUT', headers: { Cookie: headers.Cookie, 'Content-Type': 'application/json' }, body: '{}',
  })).status, 415)
  assert.equal((await fetch(`${base}/api/online/upload?day=2026-09-20&name=other.csv`, {
    method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: csv,
  })).status, 401)

  const jsonHeaders = { Cookie: headers.Cookie, 'Content-Type': 'application/json' }
  const renamed = await fetch(`${base}/api/online/file`, {
    method: 'PATCH', headers: jsonHeaders,
    body: JSON.stringify({ day: '2026-09-20', name: 'cold flow.csv', newDay: '2026-09-22', newName: 'cold-flow-renamed.csv' }),
  })
  assert.equal(renamed.status, 200)
  assert.equal((await fetch(`${base}/api/online/file?day=2026-09-20&name=cold%20flow.csv`, {
    headers: { Cookie: headers.Cookie },
  })).status, 404)
  assert.equal((await fetch(`${base}/api/online/file?day=2026-09-22&name=cold-flow-renamed.csv`, {
    headers: { Cookie: headers.Cookie },
  })).status, 200)
  const removed = await fetch(`${base}/api/online/file`, {
    method: 'DELETE', headers: jsonHeaders,
    body: JSON.stringify({ day: '2026-09-22', name: 'cold-flow-renamed.csv' }),
  })
  assert.equal(removed.status, 200)
  assert.equal((await fetch(`${base}/api/online/file?day=2026-09-22&name=cold-flow-renamed.csv`, {
    headers: { Cookie: headers.Cookie },
  })).status, 404)
})

test('team library securely uploads, catalogs, previews, and annotates nested documents', async (t) => {
  const { base, login } = await fixture(t)
  assert.equal((await fetch(`${base}/api/library/catalog`)).status, 401)
  assert.equal((await fetch(`${base}/api/library/document?path=Topics%2Fengine.md`, {
    method: 'PUT', headers: { 'Content-Type': 'text/markdown' }, body: '# Engine',
  })).status, 401)

  const loggedIn = await login()
  assert.match(loggedIn.headers.get('set-cookie'), /Path=\/api(?:;|$)/)
  const cookie = cookieOf(loggedIn)
  const headers = { Cookie: cookie }
  const upload = await fetch(`${base}/api/library/document?${new URLSearchParams({
    path: 'Topics/Propulsion/Engine.md', category: 'Propulsion', notes: 'Reviewed by the test team',
  })}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'text/markdown' }, body: '# Engine\n\n[[Injector]]' })
  assert.equal(upload.status, 201)
  assert.deepEqual((await upload.json()).document, { path: 'Topics/Propulsion/Engine.md', name: 'Engine.md', bytes: 22 })
  assert.equal((await fetch(`${base}/api/library/document?${new URLSearchParams({ path: 'Topics/Propulsion/Injector.md', category: 'Propulsion' })}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'text/markdown' }, body: '# Injector\n',
  })).status, 201)

  let catalog = await (await fetch(`${base}/api/library/catalog`, { headers })).json()
  assert.equal(catalog.documents.length, 2)
  const engine = catalog.documents.find((document) => document.path.endsWith('Engine.md'))
  assert.deepEqual({
    path: engine.path, title: engine.title, folder: engine.folder,
    category: engine.category, notes: engine.notes, kind: engine.kind,
  }, {
    path: 'Topics/Propulsion/Engine.md', title: 'Engine', folder: 'Topics/Propulsion',
    category: 'Propulsion', notes: 'Reviewed by the test team', kind: 'markdown',
  })
  assert.equal(engine.searchText, '# Engine\n\n[[Injector]]')
  assert.deepEqual(engine.links, ['Topics/Propulsion/Injector.md'])
  assert.deepEqual(await (await fetch(`${base}/api/library/search?q=chamber`, { headers })).json(), {
    indexed: false, results: [],
  })
  const file = await fetch(`${base}/api/library/file?path=Topics%2FPropulsion%2FEngine.md`, { headers })
  assert.equal(file.status, 200)
  assert.match(file.headers.get('content-type'), /^text\/markdown/)
  assert.equal(file.headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.equal(file.headers.get('content-security-policy'), "frame-ancestors 'self'")
  assert.equal(await file.text(), '# Engine\n\n[[Injector]]')

  const updated = await fetch(`${base}/api/library/document`, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'Topics/Propulsion/Engine.md', title: 'Engine systems', category: 'Systems', notes: 'Approved' }),
  })
  assert.equal(updated.status, 200)
  catalog = await (await fetch(`${base}/api/library/catalog`, { headers })).json()
  const updatedEngine = catalog.documents.find((document) => document.path.endsWith('Engine.md'))
  assert.equal(updatedEngine.title, 'Engine systems')
  assert.equal(updatedEngine.category, 'Systems')
  assert.equal(updatedEngine.notes, 'Approved')
})

test('new categories become topic nodes and PDF uploads link to selected topics', async (t) => {
  const { base, login } = await fixture(t)
  const topicUrl = `${base}/api/library/topic`
  const topicBody = { title: 'Propulsion tests' }
  assert.equal((await fetch(topicUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(topicBody) })).status, 401)
  const headers = { Cookie: cookieOf(await login()) }
  const created = await fetch(topicUrl, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(topicBody) })
  assert.equal(created.status, 201)
  assert.deepEqual((await created.json()).topic, { path: 'Topics/Propulsion tests.md', title: 'Propulsion tests' })
  assert.equal((await fetch(topicUrl, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(topicBody) })).status, 409)
  const uploadUrl = `${base}/api/library/document?${new URLSearchParams({ path: 'Sources/PDFs/Test report.pdf', category: 'Propulsion tests', topics: 'Topics/Propulsion tests.md' })}`
  const upload = () => fetch(uploadUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\ntest') })
  assert.equal((await upload()).status, 201)
  assert.equal((await upload()).status, 201)
  const catalog = await (await fetch(`${base}/api/library/catalog`, { headers })).json()
  const topic = catalog.documents.find((document) => document.path === 'Topics/Propulsion tests.md')
  assert.deepEqual(topic.links, ['Sources/PDFs/Test report.pdf'])
  assert.equal(topic.searchText.match(/\[\[Sources\/PDFs\/Test report\.pdf\]\]/g)?.length, 1)
  assert.equal(catalog.documents.find((document) => document.path === 'Sources/PDFs/Test report.pdf').category, 'Propulsion tests')
  assert.equal((await fetch(`${base}/api/library/document?${new URLSearchParams({ path: 'Sources/PDFs/Other.pdf', topics: 'Topics/Missing.md' })}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\nother'),
  })).status, 400)
  assert.equal((await fetch(`${base}/api/library/document?${new URLSearchParams({ path: 'Sources/notes.md', topics: 'Topics/Propulsion tests.md' })}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'text/markdown' }, body: '# Notes',
  })).status, 400)
})

test('read-only brain link provides catalog, search, document and paginated PDF text without a session', async (t) => {
  const { base, dataDir } = await fixture(t, { brainLinkToken })
  const link = `${base}/api/brain/${brainLinkToken}`
  const files = join(dataDir, '.library', 'files')
  await mkdir(join(files, 'Topics'), { recursive: true })
  await mkdir(join(files, 'Sources', 'PDFs'), { recursive: true })
  await writeFile(join(files, 'Topics', 'Safety.md'), '# Safety\n\n[[Sources/PDFs/Manual.pdf]]')
  await writeFile(join(files, 'Sources', 'PDFs', 'Manual.pdf'), '%PDF-test')

  assert.equal((await fetch(`${base}/api/brain/${'wrong'.repeat(10)}`)).status, 404)
  const passwordLink = `${base}/api/brain/${encodeURIComponent(password)}`
  assert.equal((await fetch(passwordLink)).status, 404)
  assert.equal((await fetch(`${passwordLink}/catalog`)).status, 404)
  assert.equal((await fetch(`${link}/document?path=Topics%2FSafety.md`, {
    method: 'PUT', body: '# overwritten',
  })).status, 404)
  assert.equal(await readFile(join(files, 'Topics', 'Safety.md'), 'utf8'), '# Safety\n\n[[Sources/PDFs/Manual.pdf]]')
  const discovery = await (await fetch(link)).json()
  assert.equal(discovery.readOnly, true)
  assert.match(discovery.endpoints.catalog, /\/catalog$/)
  const crossOrigin = await fetch(`${link}/catalog`, { headers: { Origin: 'https://agent.example', 'Sec-Fetch-Site': 'cross-site' } })
  assert.equal(crossOrigin.status, 200)
  assert.equal(crossOrigin.headers.get('access-control-allow-origin'), '*')
  assert.equal((await fetch(`${link}/catalog`, {
    method: 'POST', headers: { Origin: 'https://agent.example', 'Sec-Fetch-Site': 'cross-site' },
  })).status, 403)
  const catalogResponse = await fetch(`${link}/catalog`)
  assert.equal(catalogResponse.status, 200)
  assert.equal(catalogResponse.headers.get('access-control-allow-origin'), '*')
  const catalog = await catalogResponse.json()
  assert.equal(catalog.documents.length, 2)
  assert.deepEqual(catalog.documents.find((item) => item.kind === 'markdown').links, ['Sources/PDFs/Manual.pdf'])
  assert.deepEqual(await (await fetch(`${link}/search?q=safety`)).json(), { indexed: false, results: [] })
  const note = await (await fetch(`${link}/document?path=Topics%2FSafety.md`)).json()
  assert.match(note.content, /# Safety/)
  assert.equal(note.document.kind, 'markdown')
  const pdf = await (await fetch(`${link}/document?path=Sources%2FPDFs%2FManual.pdf`)).json()
  assert.equal(pdf.document.kind, 'pdf')
  assert.match(pdf.document.textPages, /\/text\?/)
  assert.equal(await (await fetch(`${link}/file?path=Sources%2FPDFs%2FManual.pdf`)).text(), '%PDF-test')
  assert.deepEqual(await (await fetch(`${link}/text?path=Sources%2FPDFs%2FManual.pdf`)).json(), {
    path: 'Sources/PDFs/Manual.pdf', indexed: false, totalPages: 0, pages: [],
  })
  assert.equal((await fetch(`${link}/text?path=..%2Fnotes.txt`)).status, 400)
  assert.equal((await fetch(`${link}/text?path=Sources%2FPDFs%2FManual.pdf&limit=11`)).status, 400)
  assert.equal((await fetch(`${link}/document?path=missing.md`)).status, 404)
  assert.equal((await fetch(`${link}/document`, { method: 'PUT', body: 'bad' })).status, 404)
  assert.equal((await fetch(`${base}/api/library/catalog`)).status, 401)

  const indexPath = join(dataDir, '.library', 'search', 'index.sqlite3')
  await mkdir(join(dataDir, '.library', 'search'), { recursive: true })
  const script = 'import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1])\ndb.execute("CREATE VIRTUAL TABLE passages USING fts5(path UNINDEXED,page UNINDEXED,kind UNINDEXED,body)")\ndb.executemany("INSERT INTO passages VALUES(?,?,?,?)",[("Sources/PDFs/Manual.pdf",1,"pdf","Pressure test procedures"),("Sources/PDFs/Manual.pdf",2,"pdf","Inspection criteria")])\ndb.commit()'
  const created = spawnSync('python3', ['-c', script, indexPath], { encoding: 'utf8' })
  assert.equal(created.status, 0, created.stderr)
  const pages = await (await fetch(`${link}/text?path=Sources%2FPDFs%2FManual.pdf&start=2&limit=1`)).json()
  assert.equal(pages.indexed, true)
  assert.equal(pages.totalPages, 2)
  assert.deepEqual(pages.pages, [{ page: 2, text: 'Inspection criteria' }])
})

test('library rejects hidden paths, traversal, empty files, oversized metadata, and symlinks', async (t) => {
  const { base, login, dataDir, directory } = await fixture(t)
  const headers = { Cookie: cookieOf(await login()), 'Content-Type': 'text/plain' }
  for (const path of ['../secret.txt', '.obsidian/config.json', 'Topics/.hidden', 'Topics\\secret.txt', '/../../secret.txt']) {
    assert.equal((await fetch(`${base}/api/library/document?${new URLSearchParams({ path })}`, {
      method: 'PUT', headers, body: 'private',
    })).status, 400)
  }
  assert.equal((await fetch(`${base}/api/library/document?path=empty.txt`, {
    method: 'PUT', headers, body: '',
  })).status, 400)
  await mkdir(join(dataDir, '.library', 'files'), { recursive: true })
  await writeFile(join(directory, 'outside.txt'), 'outside')
  await symlink(join(directory, 'outside.txt'), join(dataDir, '.library', 'files', 'linked.txt'))
  assert.equal((await fetch(`${base}/api/library/file?path=linked.txt`, { headers })).status, 404)
  assert.ok(!JSON.stringify(await (await fetch(`${base}/api/library/catalog`, { headers })).json()).includes('linked.txt'))
})

test('machine library sync uses a dedicated bearer token without a browser session', async (t) => {
  const { base } = await fixture(t)
  const url = `${base}/api/ingest/library?${new URLSearchParams({ path: 'Sources/guide.txt', category: 'Sources' })}`
  assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'guide' })).status, 401)
  assert.equal((await fetch(url, {
    method: 'PUT', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer wrong' }, body: 'guide',
  })).status, 401)
  const uploaded = await fetch(url, {
    method: 'PUT', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${librarySyncToken}` }, body: 'guide',
  })
  assert.equal(uploaded.status, 201)
  const catalog = await fetch(`${base}/api/ingest/library/catalog`, {
    headers: { Authorization: `Bearer ${librarySyncToken}` },
  })
  assert.equal(catalog.status, 200)
  assert.equal((await catalog.json()).documents[0].path, 'Sources/guide.txt')
  const indexUrl = `${base}/api/ingest/library/search-index`
  assert.equal((await fetch(indexUrl, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${librarySyncToken}` }, body: 'not sqlite',
  })).status, 400)
  const sqliteHeader = Buffer.concat([Buffer.from('SQLite format 3\0', 'binary'), Buffer.alloc(128)])
  assert.equal((await fetch(indexUrl, {
    method: 'PUT', headers: { 'Content-Type': 'application/vnd.sqlite3', Authorization: `Bearer ${librarySyncToken}` }, body: sqliteHeader,
  })).status, 201)
  assert.equal((await fetch(`${base}/api/library/catalog`)).status, 401)
})

test('the library SPA route falls back to the built frontend without exposing stored documents', async (t) => {
  const { base } = await fixture(t)
  assert.match(await (await fetch(`${base}/library`)).text(), /Datanator/)
  assert.match(await (await fetch(`${base}/library/Topics`)).text(), /Datanator/)
  assert.equal((await fetch(`${base}/.library/files/secret.pdf`)).status, 404)
})

test('machine token accepts CSV uploads and publishes persisted telemetry over SSE', async (t) => {
  const { base, login, dataDir } = await fixture(t)
  const machineHeaders = { Authorization: `Bearer ${ingestToken}` }
  const denied = await fetch(`${base}/api/ingest/streams/test-stand`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
    body: JSON.stringify({ values: { pressure: 12 } }),
  })
  assert.equal(denied.status, 401)

  const machineCsv = await fetch(`${base}/api/ingest/csv/2026-09-21/machine.csv`, {
    method: 'PUT', headers: { ...machineHeaders, 'Content-Type': 'text/csv' }, body: csv,
  })
  assert.equal(machineCsv.status, 201)

  const sessionHeaders = { Cookie: cookieOf(await login()) }
  const controller = new AbortController()
  const events = await fetch(`${base}/api/online/streams/test-stand/events`, { headers: sessionHeaders, signal: controller.signal })
  assert.equal(events.status, 200)
  assert.match(events.headers.get('content-type'), /text\/event-stream/)
  const reader = events.body.getReader()
  let output = new TextDecoder().decode((await reader.read()).value)
  assert.match(output, /event: ready/)

  const sample = { timestamp: '2026-09-21T01:02:03.000Z',
    values: { 'pressure (psi)': 725.4, 'mass flow kg/s': 1.7, 'temperature °C': 21.2, valve_open: true }, event: 'ignition' }
  const ingest = await fetch(`${base}/api/ingest/streams/test-stand`, {
    method: 'POST', headers: { ...machineHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(sample),
  })
  assert.equal(ingest.status, 202)
  while (!output.includes('event: sample')) output += new TextDecoder().decode((await reader.read()).value)
  assert.match(output, /"pressure \(psi\)":725\.4/)
  await reader.cancel()
  controller.abort()

  const stored = JSON.parse((await readFile(join(dataDir, '.live', 'test-stand', '2026-09-21.ndjson'), 'utf8')).trim())
  assert.equal(stored.stream, 'test-stand')
  assert.deepEqual(stored.values, sample.values)
  const streams = await fetch(`${base}/api/online/streams`, { headers: sessionHeaders })
  assert.deepEqual(await streams.json(), { streams: [{ name: 'test-stand', subscribers: 0 }] })
})

test('machine ingest fails closed when its token is not configured', async (t) => {
  const { base } = await fixture(t, { ingestToken: '' })
  const response = await fetch(`${base}/api/ingest/streams/test-stand`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ingestToken}` },
    body: JSON.stringify({ values: { pressure: 12 } }),
  })
  assert.equal(response.status, 503)
})

test('machine telemetry requires JSON and rejects unsafe or invalid samples', async (t) => {
  const { base } = await fixture(t)
  const headers = { Authorization: `Bearer ${ingestToken}` }
  assert.equal((await fetch(`${base}/api/ingest/streams/test-stand`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}',
  })).status, 415)
  assert.equal((await fetch(`${base}/api/ingest/streams/test-stand`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { 'bad\nchannel': 1 } }),
  })).status, 400)
  assert.equal((await fetch(`${base}/api/ingest/streams/test-stand`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: { pressure: { invalid: true } } }),
  })).status, 400)
})

test('untrusted forwarding headers cannot evade lockout; users behind configured proxy are isolated', async (t) => {
  const local = await fixture(t)
  for (let i = 0; i < 5; i++) await local.login('wrong', { 'X-Forwarded-For': `192.0.2.${i}` })
  assert.equal((await local.login(password, { 'X-Forwarded-For': '192.0.2.100' })).status, 429)
  const proxied = await fixture(t, { proxyHops: 1 })
  for (let i = 0; i < 5; i++) await proxied.login('wrong', { 'X-Forwarded-For': `198.51.100.${i}, 192.0.2.1` })
  assert.equal((await proxied.login(password, { 'X-Forwarded-For': '198.51.100.99, 192.0.2.1' })).status, 429)
  assert.equal((await proxied.login(password, { 'X-Forwarded-For': '192.0.2.2' })).status, 200)
})

test('missing configuration fails closed; production cookies require HTTPS; cross-site requests rejected', async (t) => {
  assert.throws(() => createApp({ production: true, password: '', secret }), /ERPL_DATA_PASSWORD/)
  assert.throws(() => createApp({ production: true, password, secret: 'short' }), /ERPL_SESSION_SECRET/)
  const unconfigured = await fixture(t, { password: '' })
  assert.equal((await unconfigured.login()).status, 503)
  assert.equal((await fetch(`${unconfigured.base}/api/online/catalog`)).status, 401)
  const configured = await fixture(t, { production: true })
  assert.match((await configured.login()).headers.get('set-cookie'), /Secure/)
  assert.equal((await configured.login(password, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
  assert.equal((await fetch(`${configured.base}/api/online/login`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ password }),
  })).status, 415)
})
