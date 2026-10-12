import { useEffect, useRef, useState } from 'react'
import { onlineRequest } from '../lib/online'
import type { LiveStatus } from '../live'

type LiveController = {
  stream: string
  status: LiveStatus
  sampleCount: number
  error: string
  connect: (stream: string) => boolean
  disconnect: () => void
}

export function LiveDialog({ live, onClose, onNeedUnlock, onInfo }: {
  live: LiveController
  onClose: () => void
  onNeedUnlock: () => void
  onInfo: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [streams, setStreams] = useState<string[]>([])
  const [name, setName] = useState(live.stream)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    const controller = new AbortController()
    void onlineRequest('status', { signal: controller.signal }).then((response) => response.json())
      .then(async (body: { authenticated: boolean }) => {
        setAuthenticated(body.authenticated)
        if (!body.authenticated) return
        const response = await onlineRequest('streams', { signal: controller.signal })
        const data = await response.json() as { streams: { name: string }[] }
        const names = data.streams.map((stream) => stream.name)
        setStreams(names)
        if (!name && names[0]) setName(names[0])
      })
      .catch((caught: Error) => setError(caught.message))
    return () => { controller.abort(); dialog.close() }
  }, [])

  const active = live.status !== 'idle'
  return (
    <dialog ref={ref} className="online-dialog live-dialog" aria-labelledby="live-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="online-heading">
        <div><div className="kicker">1-second dashboard updates</div><h2 id="live-title">Live telemetry</h2></div>
        <button type="button" className="btn" onClick={onClose} aria-label="Close live telemetry">✕</button>
      </div>
      {authenticated === null ? <p className="empty-lite">Checking access…</p> : !authenticated ? (
        <div>
          <p className="hint">Live telemetry uses the same protected ERPL data session.</p>
          <button type="button" className="btn accent" onClick={onNeedUnlock}>Unlock server data</button>
        </div>
      ) : (
        <>
          <label className="live-stream-label" htmlFor="live-stream">Stream name</label>
          <div className="live-stream-form">
            <input id="live-stream" type="text" list="live-streams" value={name}
              placeholder="test-stand" disabled={active} onChange={(event) => setName(event.target.value)} />
            <datalist id="live-streams">{streams.map((stream) => <option key={stream} value={stream} />)}</datalist>
            {active ? (
              <button type="button" className="btn" onClick={live.disconnect}>Disconnect</button>
            ) : (
              <button type="button" className="btn accent" disabled={!name.trim()}
                onClick={() => { if (live.connect(name)) setError('') }}>Connect live</button>
            )}
          </div>
          <div className={`live-state ${live.status}`}>
            <span className="live-dot" />
            <span>{live.status === 'idle' ? 'Not connected' : live.status === 'connecting' ? 'Connecting…' :
              live.status === 'reconnecting' ? 'Reconnecting…' : `Live · ${live.sampleCount.toLocaleString()} samples`}</span>
          </div>
          <p className="hint">Samples are received immediately and the plots are refreshed once per second. Up to two hours at 1 Hz are retained in this browser session.</p>
          <button type="button" className="btn compact" onClick={onInfo}>ⓘ Endpoint setup</button>
        </>
      )}
      {(error || live.error) && <p className="online-error" role="alert">{error || live.error}</p>}
    </dialog>
  )
}

export function LiveInfoDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog ref={ref} className="online-dialog live-info-dialog" aria-labelledby="live-info-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="online-heading">
        <div><div className="kicker">DAQ integration</div><h2 id="live-info-title">Live telemetry endpoint</h2></div>
        <button type="button" className="btn" onClick={onClose} aria-label="Close endpoint help">✕</button>
      </div>
      <p>Send one JSON sample per second to:</p>
      <code className="endpoint">POST https://data.erpl.space/api/ingest/streams/&lt;stream&gt;</code>
      <p className="hint">Authenticate with <code>Authorization: Bearer &lt;ERPL_INGEST_TOKEN&gt;</code>. Retrieve the token from the Render Environment page; do not put it in browser code.</p>
      <pre>{`curl --fail-with-body \\
  -X POST \\
  -H "Authorization: Bearer $ERPL_INGEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data '{"timestamp":"2026-09-21T01:02:03Z","values":{"pressure (psi)":725.4,"valve_open":true},"event":"ignition"}' \\
  https://data.erpl.space/api/ingest/streams/test-stand`}</pre>
      <p className="hint">The endpoint accepts up to 256 channels per sample. The server archives every accepted sample; signed-in viewers subscribe over SSE and redraw at a one-second cadence.</p>
    </dialog>
  )
}
