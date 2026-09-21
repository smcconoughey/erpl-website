export type ServerFile = { name: string }
export type ServerDay = { name: string; files: ServerFile[] }
export type OnlineApiError = Error & {
  error?: string
  retryAfter?: number
  attemptsRemaining?: number
  status?: number
}

export const onlineFileId = (day: string, name: string) =>
  `online:${JSON.stringify([day, name])}`

export async function onlineRequest(path: string, init?: RequestInit) {
  const response = await fetch(`/api/online/${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Partial<OnlineApiError>
    throw Object.assign(
      new Error(body.error || 'Unable to reach online data. Please try again.'),
      body,
      { status: response.status },
    ) as OnlineApiError
  }
  return response
}

export async function fetchServerCatalog(signal?: AbortSignal) {
  const response = await onlineRequest('catalog', { signal })
  return (await response.json() as { days: ServerDay[] }).days
}

export async function downloadServerFile(day: string, name: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ day, name })
  const response = await onlineRequest(`file?${query}`, { signal })
  return {
    id: onlineFileId(day, name),
    name,
    folder: day,
    buffer: await response.arrayBuffer(),
  }
}
