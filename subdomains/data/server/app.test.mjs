import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp } from './app.mjs'
import { LOCKOUT_MS } from './auth.mjs'

const password = 'test-only-shared-password'
const secret = 'test-only-session-secret-at-least-32-characters'
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
  const settings = { dataDir, distDir, password, secret, now: () => time, ...options }
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
  return { base, login, start, dataDir, directory, advance: (ms) => { time += ms } }
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
