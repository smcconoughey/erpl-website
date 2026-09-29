import type { LibraryDocument } from './LibraryApp'

export type PdfGraphEdge = { source: string; target: string; weight: number }

export function buildPdfGraph(documents: LibraryDocument[]) {
  const pdfs = documents.filter((document) => document.kind === 'pdf')
  const pdfPaths = new Set(pdfs.map((document) => document.path))
  const records = new Map<string, string[]>()
  const topics = new Map<string, Set<string>>()

  for (const document of documents) {
    if (!document.path.startsWith('Sources/Records/') || document.kind !== 'markdown') continue
    records.set(document.path, document.links.filter((path) => pdfPaths.has(path)))
  }

  const addTopic = (topic: string, path: string) => {
    if (!pdfPaths.has(path)) return
    if (!topics.has(topic)) topics.set(topic, new Set())
    topics.get(topic)!.add(path)
  }

  for (const document of documents) {
    if (!document.path.startsWith('Topics/') || document.kind !== 'markdown') continue
    for (const target of document.links) {
      if (pdfPaths.has(target)) addTopic(document.path, target)
      else records.get(target)?.forEach((path) => addTopic(document.path, path))
    }
  }
  for (const document of documents) {
    if (!records.has(document.path)) continue
    for (const topic of document.links.filter((path) => path.startsWith('Topics/'))) {
      records.get(document.path)?.forEach((path) => addTopic(topic, path))
    }
  }

  const edges = new Map<string, PdfGraphEdge>()
  for (const members of topics.values()) {
    const paths = [...members].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (paths.length < 2) continue
    const offsets = paths.length > 5 ? [1, 2] : [1]
    for (let index = 0; index < paths.length; index += 1) {
      for (const offset of offsets) {
        const target = paths[(index + offset) % paths.length]
        const [source, destination] = [paths[index], target].sort()
        const key = `${source}\u0000${destination}`
        const edge = edges.get(key)
        if (edge) edge.weight += 1
        else edges.set(key, { source, target: destination, weight: 1 })
      }
    }
  }

  return { pdfs, edges: [...edges.values()], topicCount: topics.size }
}
