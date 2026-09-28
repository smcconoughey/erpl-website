import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'

const source = resolve(process.env.LIBRARY_SOURCE || '')
const baseUrl = (process.env.ERPL_LIBRARY_URL || 'https://data.erpl.space').replace(/\/$/, '')
const password = process.env.ERPL_DATA_PASSWORD
const syncToken = process.env.ERPL_LIBRARY_SYNC_TOKEN
if (!process.env.LIBRARY_SOURCE || (!password && !syncToken)) {
  console.error('Set LIBRARY_SOURCE and either ERPL_DATA_PASSWORD or ERPL_LIBRARY_SYNC_TOKEN before running this uploader.')
  process.exit(1)
}

const ignoredDirectories = new Set(['.venv', '.retrieval', '.obsidian', '.git', 'node_modules'])
const ignoredFiles = new Set(['.DS_Store'])
const mimeTypes = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.pdf': 'application/pdf', '.json': 'application/json',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.html': 'text/html', '.xml': 'application/xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.canvas': 'application/json', '.base': 'text/plain', '.command': 'text/plain',
}

async function walk(folder) {
  const files = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (ignoredFiles.has(entry.name) || (entry.isDirectory() && ignoredDirectories.has(entry.name))) continue
    const path = join(folder, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

let headers
let existing = new Map()
if (syncToken) {
  headers = { Authorization: `Bearer ${syncToken}` }
  const catalogResponse = await fetch(`${baseUrl}/api/ingest/library/catalog`, { headers })
  if (!catalogResponse.ok) throw new Error(`Unable to read library sync catalog (${catalogResponse.status}).`)
  const catalog = await catalogResponse.json()
  existing = new Map(catalog.documents.map((document) => [document.path, document.size]))
} else {
  const login = await fetch(`${baseUrl}/api/library/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  })
  if (!login.ok) throw new Error(`Library login failed (${login.status}): ${await login.text()}`)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Library login did not return a session cookie.')
  headers = { Cookie: cookie }
  const catalogResponse = await fetch(`${baseUrl}/api/library/catalog`, { headers })
  if (!catalogResponse.ok) throw new Error(`Unable to read library catalog (${catalogResponse.status}).`)
  const catalog = await catalogResponse.json()
  existing = new Map(catalog.documents.map((document) => [document.path, document.size]))
}
const files = await walk(source)
let uploaded = 0
let skipped = 0
let bytes = 0

for (let index = 0; index < files.length; index += 1) {
  const file = files[index]
  const fileStat = await stat(file)
  const path = relative(source, file).split(sep).join('/')
  if (existing.get(path) === fileStat.size) {
    skipped += 1
    console.log(`[${index + 1}/${files.length}] unchanged ${path}`)
    continue
  }
  const category = path.includes('/') ? path.split('/')[0] : (basename(path).toLowerCase() === 'home.md' ? 'Start Here' : 'Vault')
  const query = new URLSearchParams({ path, category })
  const route = syncToken ? 'api/ingest/library' : 'api/library/document'
  const response = await fetch(`${baseUrl}/${route}?${query}`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': mimeTypes[extname(path).toLowerCase()] || 'application/octet-stream' },
    body: await readFile(file),
  })
  if (!response.ok) throw new Error(`Upload failed for ${path} (${response.status}): ${await response.text()}`)
  uploaded += 1
  bytes += fileStat.size
  console.log(`[${index + 1}/${files.length}] uploaded ${path}`)
}

console.log(`Library sync complete: ${uploaded} uploaded (${(bytes / 1024 / 1024).toFixed(1)} MiB), ${skipped} unchanged.`)
