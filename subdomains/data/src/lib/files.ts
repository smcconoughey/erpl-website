export type SourceFile = {
  file: File
  folder: string
  name: string
}

function folderFromRelativePath(rel: string, fallbackName: string): { folder: string; name: string } {
  const parts = rel.replaceAll('\\', '/').split('/').filter(Boolean)
  const name = parts.pop() ?? fallbackName
  return { folder: parts.join('/'), name }
}

type AnyEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (ok: (file: File) => void, err?: (e: DOMException) => void) => void
  createReader?: () => {
    readEntries: (
      success: (entries: AnyEntry[]) => void,
      error?: (err: DOMException) => void,
    ) => void
  }
}

async function fromDirectoryEntry(entry: AnyEntry, prefix: string): Promise<SourceFile[]> {
  const reader = entry.createReader
  if (!reader) return []
  const dirReader = reader.call(entry)
  const children: AnyEntry[] = []
  const readAll = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const batch = () => {
        dirReader.readEntries(
          (ents) => {
            if (ents.length === 0) {
              resolve()
              return
            }
            children.push(...ents)
            batch()
          },
          reject,
        )
      }
      batch()
    })
  await readAll()
  const folder = prefix ? `${prefix}/${entry.name}` : entry.name
  const nested = await Promise.all(children.map((child) => fromEntry(child, folder)))
  return nested.flat()
}

async function fromEntry(entry: AnyEntry, prefix: string): Promise<SourceFile[]> {
  if (entry.isFile) {
    const fileFn = entry.file
    if (!fileFn) return []
    const file = await new Promise<File>((resolve, reject) => {
      fileFn.call(entry, resolve, reject)
    })
    if (!file.name.toLowerCase().endsWith('.csv')) return []
    return [{ file, folder: prefix, name: file.name }]
  }
  if (entry.isDirectory) {
    return fromDirectoryEntry(entry, prefix)
  }
  return []
}

export async function sourcesFromDataTransfer(dt: DataTransfer): Promise<SourceFile[]> {
  const items = [...dt.items]
  const entries = items
    .map((item) => {
      const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => AnyEntry | null }).webkitGetAsEntry
      return getter?.call(item) ?? null
    })
    .filter((e): e is AnyEntry => Boolean(e))
  if (entries.length > 0) {
    const nested = await Promise.all(entries.map((e) => fromEntry(e, '')))
    return nested.flat()
  }
  return [...dt.files]
    .filter((f) => f.name.toLowerCase().endsWith('.csv'))
    .map((file) => {
      const { folder, name } = folderFromRelativePath(file.webkitRelativePath || file.name, file.name)
      return { file, folder, name }
    })
}

export function sourcesFromFileList(list: FileList | File[]): SourceFile[] {
  return [...list]
    .filter((f) => f.name.toLowerCase().endsWith('.csv'))
    .map((file) => {
      const { folder, name } = folderFromRelativePath(file.webkitRelativePath || file.name, file.name)
      return { file, folder, name }
    })
}

export type CampaignIndex = {
  root: string
  files: { path: string; name: string; folder: string; size: number }[]
}

export async function fetchCampaign(): Promise<CampaignIndex | null> {
  try {
    const res = await fetch('/api/campaign')
    if (!res.ok) return null
    return (await res.json()) as CampaignIndex
  } catch {
    return null
  }
}

export async function fetchCampaignCsv(path: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/csv?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return res.arrayBuffer()
}
