import express from 'express'
import { randomBytes } from 'node:crypto'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuth } from './auth.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const safeName = (name) => typeof name === 'string' && name.length > 0 &&
  !name.startsWith('.') && !/[\\/:\u0000-\u001f]/.test(name)
const inside = (parent, child) => {
  const path = relative(parent, child)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production'
  const password = options.password ?? process.env.ERPL_DATA_PASSWORD
  const secret = options.secret ?? process.env.ERPL_SESSION_SECRET ?? (production ? '' : randomBytes(32).toString('hex'))
  if (production && (!password || secret.length < 32)) {
    throw new Error('Set ERPL_DATA_PASSWORD and ERPL_SESSION_SECRET (at least 32 characters) before starting in production.')
  }
  const dataDir = resolve(options.dataDir ?? process.env.ERPL_TESTDATA_DIR ?? join(root, 'testdata'))
  const distDir = resolve(options.distDir ?? join(root, 'dist'))
  if (inside(distDir, dataDir) || inside(dataDir, distDir)) throw new Error('testdata and dist must be separate directories.')
  const proxyHops = Number(options.proxyHops ?? process.env.TRUST_PROXY_HOPS ?? 0)
  if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new Error('TRUST_PROXY_HOPS must be a nonnegative integer.')
  const auth = createAuth({ password, secret, secureCookies: production, now: options.now,
    stateFile: options.stateFile ?? join(dataDir, '.auth', 'attempts.json') })
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', proxyHops)
  app.use((_req, res, next) => {
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' })
    next()
  })
  app.get('/healthz', (_req, res) => res.json({ ok: true }))
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    // Same-origin JSON requests only; never enable CORS on these endpoints.
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'Open online data from the ERPL data viewer.' })
    }
    next()
  })
  app.get('/api/online/status', auth.status)
  app.post('/api/online/login', (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Expected a JSON request.' })
    next()
  }, express.json({ limit: '8kb' }), auth.login)
  app.use('/api/online', auth.requireSession)

  async function resolveDay(day) {
    if (!safeName(day)) return null
    const path = join(dataDir, day)
    if (!(await lstat(path)).isDirectory()) return null // Also rejects symlinks.
    return inside(await realpath(dataDir), await realpath(path)) ? path : null
  }

  app.get('/api/online/catalog', async (_req, res) => {
    let entries
    try { entries = await readdir(dataDir, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return res.json({ days: [] }); throw error }
    const days = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !safeName(entry.name)) continue
      const path = await resolveDay(entry.name)
      if (!path) continue
      const files = (await readdir(path, { withFileTypes: true }))
        .filter((file) => file.isFile() && safeName(file.name) && /\.csv$/i.test(file.name))
        .map((file) => ({ name: file.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      if (files.length) days.push({ name: entry.name, files })
    }
    days.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
    res.json({ days })
  })
  app.get('/api/online/file', async (req, res, next) => {
    const { day, name } = req.query
    if (!safeName(day) || !safeName(name) || !/\.csv$/i.test(name)) {
      return res.status(400).json({ error: 'Select a CSV from a testing day.' })
    }
    try {
      const folder = await resolveDay(day)
      if (!folder) return res.status(404).json({ error: 'CSV not found.' })
      const path = join(folder, name)
      if (!(await lstat(path)).isFile() || !inside(await realpath(folder), await realpath(path))) {
        return res.status(404).json({ error: 'CSV not found.' })
      }
      res.type('text/csv').sendFile(path, { cacheControl: false, lastModified: false, acceptRanges: false }, (error) => {
        if (error) next(error)
      })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return res.status(404).json({ error: 'CSV not found.' })
      throw error
    }
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))
  // Never serve the repository, testdata directory, or server source as static files.
  app.use(express.static(distDir, { dotfiles: 'deny', index: 'index.html' }))
  app.use((_req, res) => res.status(404).send('Not found'))
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error)
    const status = error.status === 400 || error.status === 413 ? error.status : 500
    if (status === 500) console.error('Online data request failed:', error.code || error.name)
    res.status(status).json({ error: status === 500 ? 'Online data is temporarily unavailable. Please try again.' : 'Invalid request.' })
  })
  return app
}
