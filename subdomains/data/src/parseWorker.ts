import { parseCsvText } from './lib/csv'

type ParseRequest = {
  id: string
  name: string
  folder: string
  buffer: ArrayBuffer
}

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, name, folder, buffer } = e.data
  try {
    const text = new TextDecoder('utf-8').decode(buffer)
    const file = parseCsvText(text, { id, name, folder })
    self.postMessage({ ok: true, file })
  } catch (err) {
    self.postMessage({
      ok: false,
      id,
      name,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
