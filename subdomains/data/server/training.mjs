import express from 'express'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises'
import { join, extname } from 'node:path'
import ExcelJS from 'exceljs'
import { createAuth } from './auth.mjs'
import { initialWorkspace, workbookTemplates } from './training-seed.mjs'

export const MAX_TRAINING_BYTES = 10 * 1024 * 1024
const statuses = new Set(['template', 'draft', 'in-review', 'approved', 'archived'])
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const titleOf = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f]/.test(value)) fail(422, 'Enter a title of up to 160 characters.')
  return value.trim()
}
const textOf = (value, max = 200) => {
  if (typeof value !== 'string' || value.length > max) fail(422, `Text must contain no more than ${max} characters.`)
  return value.trim()
}
const dateOf = (value) => {
  if (!value) return ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(422, 'Use a valid date in YYYY-MM-DD format.')
  return value
}
const summary = ({ content, history, attachment, ...node }) => node
const snapshot = ({ history, ...node }) => structuredClone(node)

// Bound decompressed XLSX input before ExcelJS reads it. Never execute formulas,
// links, macros, or attachments; previews contain only cell display text.
export function validateWorkbook(bytes) {
  let total = 0, entries = 0, workbook = false
  // Read the ZIP central directory using its declared offset, never scan payload.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail(422, 'Upload a standard .xlsx workbook.')
  const count = bytes.readUInt16LE(end + 10)
  let offset = bytes.readUInt32LE(end + 16)
  const directoryEnd = offset + bytes.readUInt32LE(end + 12)
  if (count > 5000 || directoryEnd > end) fail(413, 'Workbook is too large to preview.')
  while (offset < directoryEnd) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) fail(422, 'Invalid workbook archive.')
    const size = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const next = offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
    if (next > directoryEnd || bytes.readUInt16LE(offset + 8) & 1) fail(422, 'Encrypted or invalid workbooks are not supported.')
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (/vbaProject\.bin$/i.test(name)) fail(422, 'Macro-enabled workbooks are not supported.')
    workbook ||= name === 'xl/workbook.xml'
    total += size; entries++; offset = next
    if (total > 30 * 1024 * 1024) fail(413, 'Workbook expands beyond the 30 MB preview limit.')
  }
  if (!workbook || entries !== count) fail(422, 'Upload a valid .xlsx workbook.')
}

export function mountTraining(app, { dataDir, secret, production, password, now = Date.now }) {
  const storage = join(dataDir, '.training')
  const stateFile = join(storage, 'workspace.json')
  const auth = createAuth({ password, secret, secureCookies: production, now,
    cookieName: 'erpl_training_session', stateFile: join(dataDir, '.auth', 'training-attempts.json') })
  const router = express.Router()
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (req.method !== 'GET' && req.headers.origin) {
      let origin
      try { origin = new URL(req.headers.origin) } catch { return res.status(403).json({ error: 'Use the ERPL training workspace.' }) }
      if (origin.host !== req.get('host') || (production && origin.protocol !== 'https:')) return res.status(403).json({ error: 'Use the ERPL training workspace.' })
    }
    next()
  })
  const json = express.json({ limit: '1100kb', type: 'application/json' })
  const requireJson = (req, res, next) => req.is('application/json') ? next() : res.status(415).json({ error: 'Expected JSON.' })
  router.get('/status', auth.status)
  router.post('/login', requireJson, express.json({ limit: '8kb' }), auth.login)
  router.use(auth.requireSession)
  router.post('/logout', requireJson, express.json({ limit: '8kb' }), auth.logout)
  let state, loading, queue = Promise.resolve()
  async function load() {
    loading ??= (async () => {
      await mkdir(storage, { recursive: true, mode: 0o700 })
      if (!(await lstat(storage)).isDirectory() || await realpath(storage) !== join(await realpath(dataDir), '.training')) fail(503, 'Training storage is unavailable.')
      try {
        if (!(await lstat(stateFile)).isFile()) fail(503, 'Training storage is unavailable.')
        state = JSON.parse(await readFile(stateFile, 'utf8'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        state = initialWorkspace()
        await persist(state)
      }
      if (state.schema !== 1 || !Array.isArray(state.nodes)) fail(503, 'Training storage needs attention.')
      return state
    })()
    await loading
    return state
  }
  async function persist(next) {
    const temp = join(storage, `${randomUUID()}.tmp`)
    await writeFile(temp, JSON.stringify(next), { mode: 0o600 })
    await rename(temp, stateFile)
  }
  function mutate(fn) {
    const operation = queue.then(async () => {
      const next = structuredClone(await load())
      const result = await fn(next)
      await persist(next)
      state = next
      return result
    })
    queue = operation.catch(() => {})
    return operation
  }
  const nodeIn = (workspace, id) => {
    const node = workspace.nodes.find((item) => item.id === id)
    if (!node) fail(404, 'Document not found.')
    return node
  }
  function parentIn(workspace, id, childId) {
    if (id === null) return null
    if (typeof id !== 'string') fail(422, 'Choose a folder.')
    let parent = nodeIn(workspace, id)
    if (parent.kind !== 'folder') fail(422, 'Choose a folder.')
    while (parent) {
      if (parent.id === childId) fail(422, 'A folder cannot be moved into itself or its descendants.')
      parent = parent.parentId ? nodeIn(workspace, parent.parentId) : null
    }
    return id
  }
  function checkVersion(node, version) {
    if (node.version !== version) fail(409, 'Someone updated this item. Reopen it before saving your changes.')
  }
  function revise(node) {
    node.history ??= []
    node.history.push(snapshot(node))
    node.version++
    node.updatedAt = new Date(now()).toISOString()
    if (node.kind !== 'folder') { node.status = 'draft'; node.approver = ''; node.reviewedOn = '' }
  }
  function applyDetails(node, body, workspace) {
    node.title = titleOf(body.title ?? node.title)
    node.parentId = parentIn(workspace, body.parentId === undefined ? node.parentId : body.parentId, node.id)
    if (node.kind === 'folder') return
    node.owner = textOf(body.owner ?? node.owner)
    node.reviewDue = dateOf(body.reviewDue ?? node.reviewDue)
    const status = body.status ?? 'draft'
    if (!statuses.has(status)) fail(422, 'Choose a valid document status.')
    node.status = status
    node.approver = status === 'approved' ? textOf(body.approver ?? '') : ''
    node.reviewedOn = status === 'approved' ? dateOf(body.reviewedOn ?? '') : ''
    if (status === 'approved' && (!node.owner || !node.approver || !node.reviewedOn || node.reviewedOn > new Date(now()).toISOString().slice(0, 10))) {
      fail(422, 'Approval requires an owner, reviewer, and review date that is not in the future.')
    }
    if (status === 'approved' && node.reviewDue && node.reviewDue < node.reviewedOn) fail(422, 'The next review cannot precede the recorded review.')
  }
  router.get('/catalog', async (_req, res) => res.json({ nodes: (await load()).nodes.map(summary) }))
  router.get('/document/:id', async (req, res) => {
    const node = nodeIn(await load(), req.params.id)
    const version = req.query.version ? Number(req.query.version) : node.version
    const selected = version === node.version ? node : node.history?.find((item) => item.version === version)
    if (!selected) fail(404, 'Revision not found.')
    res.json({ document: { ...selected, attachment: undefined, history: node.history?.map(summary) ?? [] } })
  })
  router.post('/document', requireJson, json, async (req, res) => {
    const result = await mutate(async (workspace) => {
      if (!['folder', 'markdown'].includes(req.body.kind)) fail(422, 'Create a folder or Markdown page.')
      const node = { id: randomUUID(), kind: req.body.kind, title: titleOf(req.body.title),
        parentId: parentIn(workspace, req.body.parentId ?? null), version: 1, updatedAt: new Date(now()).toISOString(), history: [] }
      if (node.kind === 'markdown') {
        const content = req.body.content ?? `# ${node.title}\n\nDraft • content to be provided.\n`
        if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) fail(413, 'Markdown pages are limited to 1 MB.')
        Object.assign(node, { content, status: 'draft', owner: '', approver: '', reviewedOn: '', reviewDue: '' })
      }
      workspace.nodes.push(node)
      return summary(node)
    })
    res.status(201).json({ document: result })
  })
  router.patch('/document/:id', requireJson, json, async (req, res) => {
    const result = await mutate(async (workspace) => {
      const node = nodeIn(workspace, req.params.id)
      checkVersion(node, req.body.version)
      revise(node)
      applyDetails(node, req.body, workspace)
      if (req.body.content !== undefined) {
        if (node.kind !== 'markdown' || typeof req.body.content !== 'string') fail(422, 'Only Markdown pages have editable text.')
        if (Buffer.byteLength(req.body.content) > 1024 * 1024) fail(413, 'Markdown pages are limited to 1 MB.')
        node.content = req.body.content
      }
      return summary(node)
    })
    res.json({ document: result })
  })
  router.put('/upload', express.raw({ type: '*/*', limit: MAX_TRAINING_BYTES }), async (req, res) => {
    const name = req.query.name
    if (typeof name !== 'string' || name.length > 200 || /[\\/\u0000-\u001f]/.test(name)) fail(422, 'Choose a Markdown or .xlsx file.')
    const extension = extname(name).toLowerCase()
    if (!['.md', '.xlsx'].includes(extension) || !Buffer.isBuffer(req.body) || !req.body.length) fail(422, 'Upload a nonempty .md or .xlsx file.')
    if (extension === '.md' && req.body.length > 1024 * 1024) fail(413, 'Markdown pages are limited to 1 MB.')
    if (extension === '.xlsx') {
      validateWorkbook(req.body)
      try { await new ExcelJS.Workbook().xlsx.load(req.body) } catch { fail(422, 'The workbook could not be opened. Save it as .xlsx and retry.') }
    }
    const result = await mutate(async (workspace) => {
      const kind = extension === '.md' ? 'markdown' : 'workbook'
      let node
      if (req.query.id) {
        node = nodeIn(workspace, req.query.id)
        checkVersion(node, Number(req.query.version))
        if (node.kind !== kind) fail(422, 'Replace this item with the same file type.')
        revise(node)
      } else {
        node = { id: randomUUID(), kind, title: titleOf(name.replace(/\.[^.]+$/, '')),
          parentId: parentIn(workspace, req.query.parentId || null), version: 1, updatedAt: new Date(now()).toISOString(),
          history: [], status: 'draft', owner: '', approver: '', reviewedOn: '', reviewDue: '' }
        workspace.nodes.push(node)
      }
      if (kind === 'markdown') node.content = req.body.toString('utf8')
      else {
        node.attachment = `${randomUUID()}.xlsx`
        await writeFile(join(storage, node.attachment), req.body, { flag: 'wx', mode: 0o600 })
      }
      return summary(node)
    })
    res.status(201).json({ document: result })
  })
  async function fileNode(req) {
    const node = nodeIn(await load(), req.params.id)
    const version = req.query.version ? Number(req.query.version) : node.version
    const selected = version === node.version ? node : node.history?.find((item) => item.version === version)
    if (!selected || selected.kind === 'folder') fail(404, 'File not found.')
    return selected
  }
  async function workbookBytes(node) {
    // Attachment names are generated IDs, never paths supplied by an upload.
    if (!/^[a-f0-9-]{36}\.xlsx$/.test(node.attachment ?? '')) fail(404, 'File not found.')
    const path = join(storage, node.attachment)
    if (!(await lstat(path)).isFile()) fail(404, 'File not found.')
    return readFile(path)
  }
  router.get('/file/:id', async (req, res) => {
    const node = await fileNode(req)
    res.attachment(`${node.title.replace(/[^\p{L}\p{N} _.-]/gu, '_')}${node.kind === 'markdown' ? '.md' : '.xlsx'}`)
    if (node.kind === 'markdown') res.type('text/markdown').send(node.content)
    else res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await workbookBytes(node))
  })
  router.get('/preview/:id', async (req, res) => {
    const node = await fileNode(req)
    if (node.kind !== 'workbook') fail(422, 'Choose a workbook.')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await workbookBytes(node))
    res.json({ sheets: workbook.worksheets.slice(0, 30).map((sheet) => ({ name: sheet.name,
      rowCount: sheet.rowCount, columnCount: sheet.columnCount,
      rows: Array.from({ length: Math.min(sheet.rowCount, 100) }, (_, i) =>
        Array.from({ length: Math.min(sheet.columnCount, 40) }, (_, j) => sheet.getRow(i + 1).getCell(j + 1).text.slice(0, 4000))),
    })), truncatedSheets: workbook.worksheets.length > 30 })
  })
  router.get('/template/:name', async (req, res) => {
    const template = Object.hasOwn(workbookTemplates, req.params.name) ? workbookTemplates[req.params.name] : null
    if (!template) fail(404, 'Template not found.')
    const workbook = new ExcelJS.Workbook()
    const instructions = workbook.addWorksheet('Read me')
    instructions.addRows([['BLANK TEMPLATE • NO QUALIFICATIONS OR APPROVALS RECORDED'],
      ['Fill in real evidence and obtain the appropriate review before relying on these records.'],
      ['Training completion and authorization are separate records.'],
      ['FMEA scoring and acceptance criteria must be defined by the review owner.']])
    instructions.getColumn(1).width = 105
    for (const [name, columns] of Object.entries(template.sheets)) {
      const sheet = workbook.addWorksheet(name)
      sheet.addRow(columns)
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203C51' } }
      sheet.columns.forEach((column) => { column.width = 24 })
      sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } }
    }
    res.attachment(`${template.title} - blank.xlsx`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(Buffer.from(await workbook.xlsx.writeBuffer()))
  })
  router.use((_req, res) => res.status(404).json({ error: 'Training endpoint not found.' }))
  app.use('/api/training', router)
}
