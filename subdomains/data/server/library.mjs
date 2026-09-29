import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

export const MAX_LIBRARY_BYTES = 100 * 1024 * 1024
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.csv', '.tsv', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.js', '.jsx',
  '.ts', '.tsx', '.py', '.c', '.h', '.cpp', '.hpp', '.rs', '.go', '.sql', '.sh', '.zsh', '.fish', '.cfg', '.ini',
  '.log', '.base', '.canvas',
])

const inside = (parent, child) => {
  const path = relative(parent, child)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function cleanPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return null
  const normalized = posix.normalize(value.replace(/^\/+/, ''))
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.') || segment.length > 255)) return null
  return normalized
}

const prettyTitle = (path) => basename(path, extname(path)).replace(/[-_]+/g, ' ')
const kindFor = (path, mime = '') => {
  const extension = extname(path).toLowerCase()
  if (extension === '.md') return 'markdown'
  if (extension === '.pdf') return 'pdf'
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(extension)) return 'text'
  return 'file'
}

function contentType(path, saved = '') {
  if (saved && /^[\w.+-]+\/[\w.+-]+(?:;\s*charset=[\w-]+)?$/.test(saved)) return saved
  const types = {
    '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    '.html': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.c': 'text/plain; charset=utf-8',
    '.h': 'text/plain; charset=utf-8', '.sql': 'text/plain; charset=utf-8', '.canvas': 'application/json; charset=utf-8',
  }
  return types[extname(path).toLowerCase()] || 'application/octet-stream'
}

export function createLibrary({ dataDir, token, now = Date.now }) {
  const root = resolve(dataDir, '.library')
  const filesRoot = join(root, 'files')
  const indexFile = join(root, 'index.json')
  let mutation = Promise.resolve()
  const tokenHash = token ? createHash('sha256').update(token).digest() : null

  function requireToken(req, res, next) {
    if (!tokenHash) return res.status(503).json({ error: 'Library machine sync has not been configured.' })
    const authorization = req.headers.authorization || ''
    const presented = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    const presentedHash = createHash('sha256').update(presented).digest()
    if (!presented || !timingSafeEqual(presentedHash, tokenHash)) return res.status(401).json({ error: 'Invalid library sync token.' })
    next()
  }

  async function readIndex() {
    try {
      const parsed = JSON.parse(await readFile(indexFile, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
  }

  async function saveIndex(index) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const temporary = `${indexFile}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(index), { mode: 0o600 })
    await rename(temporary, indexFile)
  }

  function serialized(work) {
    const next = mutation.then(work, work)
    mutation = next.catch(() => {})
    return next
  }

  async function resolveFile(rawPath) {
    const path = cleanPath(rawPath)
    if (!path) return null
    const target = resolve(filesRoot, ...path.split('/'))
    if (!inside(filesRoot, target)) return null
    try {
      const stat = await lstat(target)
      if (!stat.isFile()) return null
      if (!inside(await realpath(filesRoot), await realpath(target))) return null
      return { path, target, stat }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
      throw error
    }
  }

  async function walk(folder = filesRoot, prefix = '') {
    let entries
    try { entries = await readdir(folder, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const documents = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !cleanPath(prefix ? `${prefix}/${entry.name}` : entry.name)) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      const target = join(folder, entry.name)
      if (entry.isDirectory()) documents.push(...await walk(target, path))
      else if (entry.isFile()) documents.push({ path, stat: await lstat(target) })
    }
    return documents
  }

  async function catalog(_req, res) {
    const [files, index] = await Promise.all([walk(), readIndex()])
    const documents = files.map(({ path, stat }) => {
      const saved = index[path] || {}
      const mime = contentType(path, saved.mime)
      return {
        id: createHash('sha256').update(path).digest('hex').slice(0, 16), path, name: basename(path),
        title: saved.title || prettyTitle(path), folder: posix.dirname(path) === '.' ? '' : posix.dirname(path),
        category: saved.category || path.split('/')[0] || 'Library', notes: saved.notes || '', mime,
        kind: kindFor(path, mime), size: stat.size, uploadedAt: saved.uploadedAt || stat.birthtime.toISOString(),
        updatedAt: saved.updatedAt || stat.mtime.toISOString(),
      }
    }).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
    res.json({ documents, totalBytes: documents.reduce((sum, document) => sum + document.size, 0) })
  }

  async function upload(req, res) {
    const path = cleanPath(req.query.path)
    if (!path) return res.status(400).json({ error: 'Choose a valid relative document path.' })
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Choose a non-empty file to upload.' })
    const target = resolve(filesRoot, ...path.split('/'))
    if (!inside(filesRoot, target)) return res.status(400).json({ error: 'Choose a valid relative document path.' })
    const document = await serialized(async () => {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      const temporary = `${target}.${process.pid}.tmp`
      await writeFile(temporary, req.body, { mode: 0o600 })
      await rename(temporary, target)
      const index = await readIndex()
      const saved = index[path] || {}
      const timestamp = new Date(now()).toISOString()
      index[path] = {
        ...saved, mime: contentType(path, req.headers['content-type']),
        category: typeof req.query.category === 'string' && req.query.category.trim().slice(0, 80) || saved.category || path.split('/')[0],
        notes: typeof req.query.notes === 'string' ? req.query.notes.trim().slice(0, 4000) : saved.notes || '',
        uploadedAt: saved.uploadedAt || timestamp, updatedAt: timestamp,
      }
      await saveIndex(index)
      return { path, name: basename(path), bytes: req.body.length }
    })
    res.status(201).json({ document })
  }

  async function update(req, res) {
    const path = cleanPath(req.body?.path)
    const file = path && await resolveFile(path)
    if (!file) return res.status(path ? 404 : 400).json({ error: path ? 'Document not found.' : 'Choose a valid document.' })
    const { title, category, notes } = req.body
    if ([title, category, notes].some((value) => value !== undefined && typeof value !== 'string')) {
      return res.status(400).json({ error: 'Title, category, and notes must be text.' })
    }
    await serialized(async () => {
      const index = await readIndex()
      const saved = index[path] || {}
      index[path] = {
        ...saved,
        ...(title !== undefined ? { title: title.trim().slice(0, 160) || prettyTitle(path) } : {}),
        ...(category !== undefined ? { category: category.trim().slice(0, 80) || path.split('/')[0] } : {}),
        ...(notes !== undefined ? { notes: notes.trim().slice(0, 4000) } : {}),
        updatedAt: new Date(now()).toISOString(),
      }
      await saveIndex(index)
    })
    res.json({ ok: true })
  }

  async function file(req, res, next) {
    const found = await resolveFile(req.query.path)
    if (!found) return res.status(cleanPath(req.query.path) ? 404 : 400).json({ error: cleanPath(req.query.path) ? 'Document not found.' : 'Choose a valid document.' })
    const index = await readIndex()
    const mime = contentType(found.path, index[found.path]?.mime)
    res.set({
      'Content-Type': mime,
      'Content-Length': String(found.stat.size),
      'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${basename(found.path).replace(/["\\]/g, '')}"`,
      // The app itself stays DENY. Only authenticated library files may be
      // embedded, and only by a page on this exact origin.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    })
    const stream = createReadStream(found.target)
    stream.on('error', next)
    stream.pipe(res)
  }

  return { requireToken, catalog, upload, update, file }
}
