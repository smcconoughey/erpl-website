import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = (process.env.ERPL_LIBRARY_URL || 'https://data.erpl.space').replace(/\/$/, '')
const token = process.env.ERPL_LIBRARY_SYNC_TOKEN
const source = process.env.LIBRARY_SEARCH_INDEX

if (!token) throw new Error('Set ERPL_LIBRARY_SYNC_TOKEN before uploading the library search index.')
if (!source) throw new Error('Set LIBRARY_SEARCH_INDEX to the retrieval index.sqlite3 file.')

const path = resolve(source)
const body = await readFile(path)
if (body.length < 16 || body.subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000') {
  throw new Error(`${path} is not a SQLite database.`)
}

const response = await fetch(`${baseUrl}/api/ingest/library/search-index`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.sqlite3' },
  body,
})
const result = await response.json().catch(() => ({}))
if (!response.ok) throw new Error(result.error || `Search-index upload failed (${response.status}).`)
console.log(`Uploaded ${result.bytes.toLocaleString()} bytes of full-text search data.`)
