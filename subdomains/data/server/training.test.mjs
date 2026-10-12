import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { createApp } from './app.mjs'
import { validateWorkbook } from './training.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'erpl-training-'))
  const dataDir = join(dir, 'testdata'), distDir = join(dir, 'dist')
  await mkdir(dataDir); await mkdir(distDir)
  await writeFile(join(distDir, 'index.html'), '<h1>Public app shell</h1>')
  let now = Date.UTC(2026, 9, 6)
  const servers = []
  const start = async () => {
    const server = createApp({ dataDir, distDir, password: 'fictional-telemetry-password', secret: 'fictional-secret-over-thirty-two-characters', now: () => now }).listen(0, '127.0.0.1')
    servers.push(server); await once(server, 'listening')
    return `http://127.0.0.1:${server.address().port}`
  }
  const base = await start()
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((done) => { server.close(done); server.closeAllConnections() })))
    await rm(dir, { recursive: true, force: true })
  })
  const login = async (password = 'training', server = base) => fetch(`${server}/api/training/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  })
  const response = await login()
  const cookie = response.headers.get('set-cookie').split(';')[0]
  const request = (path, method = 'GET', body, server = base, headers = {}) => fetch(`${server}/api/training/${path}`, {
    method, headers: { Cookie: cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { dir, dataDir, base, cookie, start, login, request, advance: (ms) => { now += ms } }
}

async function workbook(text = 'Fictional evidence') {
  const book = new ExcelJS.Workbook()
  book.addWorksheet('Records').addRows([['Person', 'Evidence'], ['Fictional member', text]])
  return Buffer.from(await book.xlsx.writeBuffer())
}

test('training requires its own server session for all content, files, templates and mutations', async (t) => {
  const f = await fixture(t)
  for (const path of ['catalog', 'document/red-team', 'file/red-team', 'preview/red-team', 'template/fmea']) {
    const result = await fetch(`${f.base}/api/training/${path}`)
    assert.equal(result.status, 401); assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.ok(!(await result.text()).includes('prerequisites'))
  }
  assert.equal((await f.login('wrong')).status, 401)
  const telemetryLogin = await fetch(`${f.base}/api/online/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fictional-telemetry-password' }) })
  const telemetryCookie = telemetryLogin.headers.get('set-cookie').split(';')[0]
  assert.equal((await fetch(`${f.base}/api/training/catalog`, { headers: { Cookie: telemetryCookie } })).status, 401)
  assert.equal((await fetch(`${f.base}/api/online/catalog`, { headers: { Cookie: f.cookie } })).status, 401)
  assert.equal((await f.request('status')).status, 200)
  assert.equal((await f.request('document', 'POST', { kind: 'folder', title: 'Cross origin' }, f.base, { Origin: 'https://different.example' })).status, 403)
  assert.equal((await fetch(`${f.base}/api/training/document`, { method: 'POST', headers: { Cookie: f.cookie, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415)
  for (const path of ['/.training/workspace.json', '/testdata/.training/workspace.json', '/server/training-seed.mjs']) assert.equal((await fetch(f.base + path)).status, 404)
  for (const path of ['/training', '/training/qualification']) assert.match(await (await fetch(f.base + path)).text(), /Public app shell/)
  await f.request('logout', 'POST', {})
  // A cleared cookie is a browser logout; an old copied token remains valid until its short expiry.
  const logout = await f.request('logout', 'POST', {})
  assert.match(logout.headers.get('set-cookie'), /erpl_training_session=;/)
  f.advance(60 * 60 * 1000)
  assert.equal((await f.request('catalog')).status, 401)
})

test('starter content is templates, with blank Excel registers and no fabricated approvals', async (t) => {
  const f = await fixture(t)
  const { nodes } = await (await f.request('catalog')).json()
  assert.equal(nodes.filter((node) => node.kind === 'folder').length, 5)
  assert.ok(nodes.filter((node) => node.kind !== 'folder').every((node) => node.status === 'template' && !node.owner && !node.approver))
  assert.equal(nodes.some((node) => 'content' in node || 'history' in node), false)
  for (const name of ['qualifications', 'fmea', 'inspections']) {
    const result = await f.request(`template/${name}`)
    assert.equal(result.status, 200)
    assert.match(result.headers.get('content-disposition'), /blank/)
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(Buffer.from(await result.arrayBuffer()))
    assert.match(book.getWorksheet('Read me').getCell('A1').text, /NO QUALIFICATIONS OR APPROVALS/)
    for (const sheet of book.worksheets.filter((item) => item.name !== 'Read me')) assert.equal(sheet.rowCount, 1)
  }
})

test('Markdown edits persist across restart, preserve revisions, enforce review fields and reject stale writes', async (t) => {
  const f = await fixture(t)
  const created = await (await f.request('document', 'POST', { kind: 'markdown', title: 'Fictional procedure', parentId: 'section-1', content: '# Draft\n\nInitial text' })).json()
  const id = created.document.id
  assert.equal(created.document.status, 'draft')
  const details = { version: 1, content: '# Reviewed\n\nRevised text', status: 'approved', owner: 'Fictional owner', approver: 'Fictional reviewer', reviewedOn: '2026-10-05' }
  assert.equal((await f.request(`document/${id}`, 'PATCH', { ...details, approver: '' })).status, 422)
  assert.equal((await f.request(`document/${id}`, 'PATCH', { ...details, reviewedOn: '2026-99-99' })).status, 422)
  assert.equal((await f.request(`document/${id}`, 'PATCH', { ...details, reviewedOn: '2026-10-07' })).status, 422)
  assert.equal((await f.request(`document/${id}`, 'PATCH', details)).status, 200)
  assert.equal((await f.request(`document/${id}`, 'PATCH', details)).status, 409)
  const old = await (await f.request(`document/${id}?version=1`)).json()
  assert.equal(old.document.content, '# Draft\n\nInitial text')
  assert.equal(old.document.history.length, 1)
  const edited = await (await f.request(`document/${id}`, 'PATCH', { version: 2, title: 'Edited procedure', content: '# New draft' })).json()
  assert.equal(edited.document.status, 'draft'); assert.equal(edited.document.approver, '')
  const restarted = await f.start()
  const record = await (await f.request(`document/${id}`, 'GET', undefined, restarted)).json()
  assert.equal(record.document.version, 3); assert.equal(record.document.content, '# New draft')
  assert.equal(await (await f.request(`file/${id}?version=2`)).text(), '# Reviewed\n\nRevised text')
  const stored = JSON.parse(await readFile(join(f.dataDir, '.training', 'workspace.json')))
  assert.equal(stored.nodes.find((node) => node.id === id).history.length, 2)
})

test('folders can be nested and moved but cannot contain themselves or descendants', async (t) => {
  const f = await fixture(t)
  const folder = (await (await f.request('document', 'POST', { kind: 'folder', title: 'Fictional folder' })).json()).document
  const child = (await (await f.request('document', 'POST', { kind: 'folder', title: 'Nested folder', parentId: folder.id })).json()).document
  assert.equal((await f.request(`document/${folder.id}`, 'PATCH', { version: 1, parentId: child.id })).status, 422)
  assert.equal((await f.request(`document/${child.id}`, 'PATCH', { version: 1, parentId: child.id })).status, 422)
  assert.equal((await f.request(`document/${child.id}`, 'PATCH', { version: 1, parentId: 'red-team' })).status, 422)
  assert.equal((await f.request(`document/${child.id}`, 'PATCH', { version: 1, parentId: 'section-2', title: 'Renamed folder' })).status, 200)
  assert.equal((await f.request('document', 'POST', { kind: 'markdown', title: 'Missing parent', parentId: '../../' })).status, 404)
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => f.request('document', 'POST', { kind: 'markdown', title: `Concurrent fictional ${i}` })))
  assert.ok(results.every((result) => result.status === 201))
  const { nodes } = await (await f.request('catalog')).json()
  assert.equal(nodes.filter((node) => node.title.startsWith('Concurrent fictional')).length, 6)
})

test('Excel uploads preview, download and replace without losing previous workbook bytes', async (t) => {
  const f = await fixture(t)
  const bytes = await workbook()
  const upload = (params, data = bytes) => fetch(`${f.base}/api/training/upload?${new URLSearchParams(params)}`, {
    method: 'PUT', headers: { Cookie: f.cookie, 'Content-Type': 'application/octet-stream' }, body: data,
  })
  const result = await upload({ name: 'Fictional.xlsx', parentId: 'section-0' })
  assert.equal(result.status, 201)
  const id = (await result.json()).document.id
  const preview = await (await f.request(`preview/${id}`)).json()
  assert.deepEqual(preview.sheets[0].rows, [['Person', 'Evidence'], ['Fictional member', 'Fictional evidence']])
  const downloaded = Buffer.from(await (await f.request(`file/${id}`)).arrayBuffer())
  assert.deepEqual(downloaded, bytes)
  const replacement = await workbook('<script>literal cell text</script>')
  assert.equal((await upload({ name: 'Fictional.xlsx', id, version: '1' }, replacement)).status, 201)
  assert.equal((await upload({ name: 'Fictional.xlsx', id, version: '1' })).status, 409)
  assert.deepEqual(Buffer.from(await (await f.request(`file/${id}?version=1`)).arrayBuffer()), bytes)
  assert.equal((await (await f.request(`preview/${id}`)).json()).sheets[0].rows[1][1], '<script>literal cell text</script>')
  assert.equal((await upload({ name: '../escape.xlsx' })).status, 422)
  assert.equal((await upload({ name: 'file.html' })).status, 422)
  assert.equal((await upload({ name: 'not-a-workbook.xlsx' }, Buffer.from('fake'))).status, 422)
  assert.equal((await upload({ name: 'too-large.md' }, Buffer.alloc(1024 * 1024 + 1, 65))).status, 413)
  assert.equal((await upload({ name: 'too-large.xlsx' }, Buffer.alloc(10 * 1024 * 1024 + 1, 65))).status, 413)
  assert.equal((await f.request(`document/${id}`, 'PATCH', { version: 2, content: 'wrong type' })).status, 422)
})

test('training storage rejects symlinked state and oversized expanded workbook archives', async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.dataDir, '.training'))
  await writeFile(join(f.dir, 'outside.json'), '{"schema":1,"nodes":[]}')
  await symlink(join(f.dir, 'outside.json'), join(f.dataDir, '.training', 'workspace.json'))
  assert.equal((await f.request('catalog')).status, 503)
  const bytes = await workbook()
  const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes.writeUInt32LE(31 * 1024 * 1024, offset + 24)
  assert.throws(() => validateWorkbook(bytes), (error) => error.status === 413)
})
