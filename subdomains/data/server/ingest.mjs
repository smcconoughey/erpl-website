import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, lstat, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

const MAX_CSV_BYTES = 25 * 1024 * 1024
const MAX_CHANNELS = 256
const safeSegment = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  !value.startsWith('.') && !/[\\/:\u0000-\u001f]/.test(value)
const inside = (parent, child) => {
  const path = relative(parent, child)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}
const digest = (value) => createHash('sha256').update(value).digest()

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createIngest({ dataDir, token, now = Date.now, heartbeatMs = 15000 }) {
  if (token && token.length < 32) throw new Error('ERPL_INGEST_TOKEN must be at least 32 characters.')
  const tokenHash = digest(token || '')
  const subscribers = new Map()
  const pendingWrites = new Map()

  function requireToken(req, res, next) {
    if (!token) return res.status(503).json({ error: 'Telemetry ingest has not been configured yet.' })
    const match = /^Bearer ([^\s]{1,2048})$/.exec(req.headers.authorization || '')
    if (!match || !timingSafeEqual(digest(match[1]), tokenHash)) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Invalid telemetry ingest token.' })
    }
    next()
  }

  async function csvPath(day, name) {
    if (!safeSegment(day) || !safeSegment(name, 255) || !/\.csv$/i.test(name)) {
      throw new RequestError(400, 'Use a testing-day folder and a safe .csv filename.')
    }
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    const root = await realpath(dataDir)
    const folder = join(root, day)
    await mkdir(folder, { recursive: true, mode: 0o700 })
    if (!(await lstat(folder)).isDirectory() || !inside(root, await realpath(folder))) {
      throw new RequestError(400, 'Invalid testing-day folder.')
    }
    const path = join(folder, name)
    try {
      const current = await lstat(path)
      if (!current.isFile()) throw new RequestError(400, 'The upload target is not a regular file.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return { folder, path }
  }

  async function saveCsv(day, name, bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new RequestError(400, 'Upload a non-empty CSV file.')
    if (bytes.length > MAX_CSV_BYTES) throw new RequestError(413, 'CSV uploads are limited to 25 MB.')
    const { folder, path } = await csvPath(day, name)
    const temporary = join(folder, `.upload-${randomBytes(12).toString('hex')}.tmp`)
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
    return { day, name, bytes: bytes.length }
  }

  function browserUpload(req, res, next) {
    saveCsv(req.query.day, req.query.name, req.body)
      .then((saved) => res.status(201).json({ ok: true, file: saved }))
      .catch(next)
  }

  function machineUpload(req, res, next) {
    saveCsv(req.params.day, req.params.name, req.body)
      .then((saved) => res.status(201).json({ ok: true, file: saved }))
      .catch(next)
  }

  function normalizeSample(stream, body) {
    if (!safeSegment(stream, 64)) throw new RequestError(400, 'Use a safe stream name of up to 64 characters.')
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      throw new RequestError(400, 'Send JSON with a values object.')
    }
    const entries = Object.entries(body.values)
    if (!entries.length || entries.length > MAX_CHANNELS) {
      throw new RequestError(400, `A sample must contain between 1 and ${MAX_CHANNELS} channels.`)
    }
    const values = Object.create(null)
    for (const [name, value] of entries) {
      if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new RequestError(400, 'Telemetry channel names must be 1-128 characters without control characters.')
      }
      if (typeof value === 'number' && Number.isFinite(value)) values[name] = value
      else if (typeof value === 'boolean' || value === null) values[name] = value
      else if (typeof value === 'string' && value.length <= 512) values[name] = value
      else throw new RequestError(400, 'Telemetry values must be finite numbers, booleans, null, or short strings.')
    }
    const receivedAt = new Date(now()).toISOString()
    const date = body.timestamp === undefined ? new Date(receivedAt) : new Date(body.timestamp)
    if (!Number.isFinite(date.getTime())) throw new RequestError(400, 'timestamp must be an ISO date or epoch milliseconds.')
    const sample = { stream, timestamp: date.toISOString(), receivedAt, values }
    if (body.event !== undefined) {
      if (typeof body.event !== 'string' || body.event.length > 512) throw new RequestError(400, 'event must be a short string.')
      sample.event = body.event
    }
    return sample
  }

  async function ingestSample(req, res, next) {
    try {
      const sample = normalizeSample(req.params.stream, req.body)
      const folder = join(dataDir, '.live', sample.stream)
      await mkdir(folder, { recursive: true, mode: 0o700 })
      const path = join(folder, `${sample.timestamp.slice(0, 10)}.ndjson`)
      const write = (pendingWrites.get(path) || Promise.resolve())
        .then(() => appendFile(path, `${JSON.stringify(sample)}\n`, { mode: 0o600 }))
      const tracked = write.catch(() => {})
      pendingWrites.set(path, tracked)
      try { await write } finally {
        if (pendingWrites.get(path) === tracked) pendingWrites.delete(path)
      }
      const payload = `event: sample\ndata: ${JSON.stringify(sample)}\n\n`
      for (const response of subscribers.get(sample.stream) || []) {
        if (!response.write(payload)) response.end()
      }
      res.status(202).json({ ok: true, sample })
    } catch (error) { next(error) }
  }

  async function streamNames() {
    const names = new Set(subscribers.keys())
    try {
      for (const entry of await readdir(join(dataDir, '.live'), { withFileTypes: true })) {
        if (entry.isDirectory() && safeSegment(entry.name, 64)) names.add(entry.name)
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  async function listStreams(_req, res, next) {
    try {
      res.json({ streams: (await streamNames()).map((name) => ({ name, subscribers: subscribers.get(name)?.size || 0 })) })
    } catch (error) { next(error) }
  }

  function liveEvents(req, res) {
    const stream = req.params.stream
    if (!safeSegment(stream, 64)) return res.status(400).json({ error: 'Select a valid telemetry stream.' })
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders?.()
    res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ stream })}\n\n`)
    const clients = subscribers.get(stream) || new Set()
    clients.add(res)
    subscribers.set(stream, clients)
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), heartbeatMs)
    const expires = setTimeout(() => res.end(), 60 * 60 * 1000)
    const close = () => {
      clearInterval(heartbeat)
      clearTimeout(expires)
      clients.delete(res)
      if (!clients.size) subscribers.delete(stream)
    }
    req.once('close', close)
    res.once('close', close)
  }

  return { browserUpload, ingestSample, listStreams, liveEvents, machineUpload, requireToken }
}

export { MAX_CSV_BYTES }
