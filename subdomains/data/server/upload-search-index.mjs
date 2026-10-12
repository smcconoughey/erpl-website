import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = (process.env.ERPL_LIBRARY_URL || 'https://data.erpl.space').replace(/\/$/, '')
const token = process.env.ERPL_LIBRARY_SYNC_TOKEN
const password = process.env.ERPL_DATA_PASSWORD
const source = process.env.LIBRARY_SEARCH_INDEX

if (!token && !password) throw new Error('Set ERPL_LIBRARY_SYNC_TOKEN or ERPL_DATA_PASSWORD before uploading the library search index.')
if (!source) throw new Error('Set LIBRARY_SEARCH_INDEX to the retrieval index.sqlite3 file.')

const path = resolve(source)
const body = await readFile(path)
if (body.length < 16 || body.subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000') {
  throw new Error(`${path} is not a SQLite database.`)
}

let headers = token ? { Authorization: `Bearer ${token}` } : {}
if (!token) {
  const login = await fetch(`${baseUrl}/api/library/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  })
  if (!login.ok) throw new Error(`Library login failed (${login.status}): ${await login.text()}`)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('Library login did not return a session cookie.')
  headers = { Cookie: cookie }
}

const route = token ? '/api/ingest/library/search-index' : '/api/library/search-index'
const response = await fetch(`${baseUrl}${route}`, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/vnd.sqlite3' },
  body,
})
const result = await response.json().catch(() => ({}))
if (!response.ok) throw new Error(result.error || `Search-index upload failed (${response.status}).`)
console.log(`Uploaded ${result.bytes.toLocaleString()} bytes of full-text search data.`)
