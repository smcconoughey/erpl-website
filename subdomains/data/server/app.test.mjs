import assert from 'node:assert/strict'
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
  const settings = { dataDir, distDir, password, secret, ingestToken, now: () => time, ...options }
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
  assert.match(await (await fetch(base)).text(), /Datanator/)
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
    body: JSON.stringify({ day: '2026-09-20', name: 'cold flow.csv', newDay: '2026-09-20', newName: 'cold-flow-renamed.csv' }),
  })
  assert.equal(renamed.status, 200)
  assert.equal((await fetch(`${base}/api/online/file?day=2026-09-20&name=cold%20flow.csv`, {
    headers: { Cookie: headers.Cookie },
  })).status, 404)
  assert.equal((await fetch(`${base}/api/online/file?day=2026-09-20&name=cold-flow-renamed.csv`, {
    headers: { Cookie: headers.Cookie },
  })).status, 200)
  const removed = await fetch(`${base}/api/online/file`, {
    method: 'DELETE', headers: jsonHeaders,
    body: JSON.stringify({ day: '2026-09-20', name: 'cold-flow-renamed.csv' }),
  })
  assert.equal(removed.status, 200)
  assert.equal((await fetch(`${base}/api/online/file?day=2026-09-20&name=cold-flow-renamed.csv`, {
    headers: { Cookie: headers.Cookie },
  })).status, 404)
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
