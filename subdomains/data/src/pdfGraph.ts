import type { LibraryDocument } from './LibraryApp'

export type PdfGraphEdge = { source: string; target: string; kind: 'citation' | 'topic' }

export function buildPdfGraph(documents: LibraryDocument[]) {
  const pdfs = documents.filter((document) => document.kind === 'pdf')
  const pdfPaths = new Set(pdfs.map((document) => document.path))
  const topics = documents.filter((document) => document.kind === 'markdown' && document.path.startsWith('Topics/') && document.path.toLowerCase() !== 'topics/topic directory.md')
  const topicPaths = new Set(topics.map((document) => document.path))
  const records = new Map<string, string[]>()
  const citations = new Map<string, Set<string>>()

  for (const document of documents) {
    if (!document.path.startsWith('Sources/Records/') || document.kind !== 'markdown') continue
    records.set(document.path, document.links.filter((path) => pdfPaths.has(path)))
  }

  const addTopic = (topic: string, path: string) => {
    if (!topicPaths.has(topic) || !pdfPaths.has(path)) return
    if (!citations.has(topic)) citations.set(topic, new Set())
    citations.get(topic)!.add(path)
  }

  for (const document of topics) {
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

  const edges: PdfGraphEdge[] = []
  for (const [topic, members] of citations) {
    for (const path of members) edges.push({ source: topic, target: path, kind: 'citation' })
  }
  const topicKeys = new Set<string>()
  for (const document of topics) {
    for (const target of document.links) {
      if (!topicPaths.has(target) || target === document.path) continue
      const [source, destination] = [document.path, target].sort()
      const key = `${source}\u0000${destination}`
      if (topicKeys.has(key)) continue
      topicKeys.add(key)
      edges.push({ source, target: destination, kind: 'topic' })
    }
  }

  return { pdfs, topics, nodes: [...topics, ...pdfs], edges }
}
