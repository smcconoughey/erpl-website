import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const LOCKOUT_MS = 5 * 60 * 1000
const SESSION_MS = 60 * 60 * 1000
const COOKIE = 'erpl_data_session'
const digest = (value) => createHash('sha256').update(value).digest()

// One server process owns this file. Keep it on the persistent testdata disk so
// restarts, page reloads, and cleared cookies cannot reset a lockout.
export function createAuth({ password, secret, stateFile, secureCookies, now = Date.now }) {
  const passwordHash = digest(password || '')
  const sessionKey = createHmac('sha256', secret).update(passwordHash).digest()
  const sign = (value) => createHmac('sha256', sessionKey).update(value).digest('base64url')
  const attempts = new Map(existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : [])
  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/online' }

  function save() {
    for (const [key, entry] of attempts) {
      if (entry.expires <= now()) attempts.delete(key)
    }
    mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 })
    writeFileSync(`${stateFile}.tmp`, JSON.stringify([...attempts]), { mode: 0o600 })
    renameSync(`${stateFile}.tmp`, stateFile)
  }

  function attemptState(req) {
    const key = digest(req.ip || req.socket.remoteAddress || 'unknown').toString('hex')
    const entry = attempts.get(key)
    return { key, entry: entry?.expires > now() ? entry : undefined }
  }

  function locked(res, entry) {
    const retryAfter = Math.max(1, Math.ceil((entry.lockedUntil - now()) / 1000))
    return res.status(429).set('Retry-After', String(retryAfter)).json({
      error: 'Too many incorrect passwords. Please wait before trying again.', retryAfter, attemptsRemaining: 0,
    })
  }

  function status(req, res) {
    if (!password) return res.status(503).json({ error: 'Online data has not been configured yet.' })
    if (hasSession(req)) return res.json({ authenticated: true, attemptsRemaining: 5 })
    const { entry } = attemptState(req)
    if (entry?.lockedUntil > now()) return locked(res, entry)
    return res.json({ authenticated: false, attemptsRemaining: 5 - (entry?.failures || 0) })
  }

  function login(req, res) {
    if (!password) return res.status(503).json({ error: 'Online data has not been configured yet.' })
    const { key, entry } = attemptState(req)
    if (entry?.lockedUntil > now()) return locked(res, entry)
    if (typeof req.body?.password !== 'string' || !req.body.password || req.body.password.length > 1024) {
      return res.status(400).json({ error: 'Enter a password of up to 1,024 characters.' })
    }
    if (!timingSafeEqual(digest(req.body.password), passwordHash)) {
      // Bound state growth without evicting active lockouts.
      if (!attempts.has(key) && attempts.size >= 10000) {
        save()
        if (attempts.size >= 10000) return res.status(503).json({ error: 'Please try again later.' })
      }
      const failures = (entry?.failures || 0) + 1
      const lockedUntil = failures >= 5 ? now() + LOCKOUT_MS : 0
      const updated = { failures, lockedUntil, expires: lockedUntil || now() + 24 * 60 * 60 * 1000 }
      attempts.set(key, updated)
      save()
      if (lockedUntil) return locked(res, updated)
      return res.status(401).json({ error: 'Incorrect password.', attemptsRemaining: 5 - failures })
    }
    attempts.delete(key)
    save()
    const payload = `${now() + SESSION_MS}.${randomBytes(24).toString('base64url')}`
    res.cookie(COOKIE, `${payload}.${sign(payload)}`, { ...cookieOptions, maxAge: SESSION_MS })
    return res.json({ ok: true })
  }

  function hasSession(req) {
    const token = (req.headers.cookie || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || ''
    const [expires, nonce, signature, extra] = token.split('.')
    const expected = sign(`${expires}.${nonce}`)
    return Boolean(password && extra === undefined && nonce && signature && /^[A-Za-z0-9_-]{43}$/.test(signature) &&
      Number.isFinite(Number(expires)) && Number(expires) > now() &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
  }

  function requireSession(req, res, next) {
    if (!hasSession(req)) {
      res.clearCookie(COOKIE, cookieOptions)
      return res.status(401).json({ error: 'Please enter the shared password to access online data.' })
    }
    next()
  }

  return { status, login, requireSession }
}
