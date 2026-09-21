# Datanator

CSV campaign viewer for ERPL test data. Load a folder of CSVs, plot any numeric
channel against time, stack plots, put independent axes on the same chart, save
zoom views, and measure slopes between cursors.

This app is published at `https://data.erpl.space/`.

## Local development

```bash
cd subdomains/data
npm install
npm run dev
```

Node 22.12+ is required (Vite 7). Open the URL Vite prints (usually http://localhost:5173).

For online data, copy `.env.example` to `.env`, set `ERPL_DATA_PASSWORD` to the
shared club password, and set `ERPL_SESSION_SECRET` to a random secret generated
with the command in that file. In a second terminal in this directory run:

```bash
npm run dev:server
```

Vite proxies `/api` to this server on port 3001. Local file loading still works
without the server. Use `npm run build` and `npm start` to check the combined
production build at `http://localhost:3001` (leave `NODE_ENV` unset for local HTTP).
`npm run preview` previews only the static frontend, without the online API.

## Load data

- **Open folder / Open files** — pick any nested set of CSVs on disk.
- Drag and drop files or folders onto the window.
- **Open Online ERPL Data** — enter the shared password to automatically open
  every server CSV that is not already in the workspace.
  The lower-left server library still lets you open individual files and use
  **Upload new** to browse, select, and upload data. Reopening either view reuses
  your sign-in. Local files with matching names are kept separate from online
  files.
- **Server files** — the lower-left library lists every uploaded CSV after sign-in.
  Open a file directly, download it, change its date or filename, delete it with
  confirmation, or use **Upload new** without leaving the plotting workspace.
- **Live** — connect to a named telemetry stream from the top toolbar. Incoming
  samples are archived immediately and the browser redraws at a one-second cadence.

Time is taken from `elapsed_s` when present, otherwise from a timestamp column.
Numeric channels are grouped (pressure, load, temperature, discrete, bang-bang).
Event strings become markers on the plot.

## Inverse performance analysis

The bottom-right inspector has separate **Analysis** and **Config** tabs. Config
is saved in the browser per CSV and maps chamber pressure, thrust, runline states,
and each venturi's inlet/throat pressure pair. Each venturi stores a calibrated `CdA` and
fluid density; the current Draco source-of-truth `CdA` of `3.22e-05 m²` is the
default. Mass flow is calculated from:

`mdot = CdA * sqrt(2 * density * (P_inlet - P_throat))`

IPA and ethanol selections fill editable nominal fuel densities of 785 and
789 kg/m³, respectively. Analysis prefers the overlapping oxidizer/fuel runline
interval for its automatic firing window, then falls back to chamber pressure. It
creates plot-ready oxidizer, fuel, and total mass-flow channels plus O/F and
measured specific impulse. Engine performance uses one explicit solve basis:
known throat area, reference Cf, or reference c-star. This is required because
throat area, Cf, and c-star are not independently identifiable from chamber
pressure, thrust, and mass flow alone. Depending on the selected basis, the tool
derives measured Cf, measured c-star, and effective throat area/diameter without
silently inventing the missing constraint.

Thrust polarity, pre-fire tare, and scale are configurable per run. The default
auto mode preserves normal positive thrust traces while correcting an inverted
load-cell deflection. Implausible thrust and Cf values produce warnings instead
of being presented without qualification.

### NASA CEA

The analysis action also sends the firing-window average chamber pressure and
O/F ratio to the authenticated `/api/online/cea/rocket` endpoint. The endpoint
runs NASA's official `cea==3.3.4` Python package and returns equilibrium or
frozen-from-throat ideal chamber/nozzle results, including flame temperature,
gamma, molecular weight, c-star, Cf, Isp, exit Mach, and major chamber species.
Pc and O/F can be overridden per CSV, along with inlet temperatures, ambient
pressure, and nozzle area ratio.

CEA includes liquid oxygen and liquid ethanol in its thermodynamic database.
It does not include condensed 2-propanol, so IPA is supplied as a custom liquid
`C3H8O` reactant using NIST's standard liquid formation enthalpy (-317.0 kJ/mol)
and 298.15 K liquid heat capacity (161.2 J/mol-K) for the inlet-temperature
sensible correction. The UI identifies this model explicitly.

`npm run build` installs the pinned CEA wheel into `.python` when Python 3.11+
is available. Render's native runtime provides Python and pip alongside Node;
the Express server launches a bounded Python solve for each authenticated CEA
request.

## Private online data

Place files on the server under `subdomains/data/testdata/<testing-day>/*.csv`.
For example, `testdata/2026-09-19/hot-fire-01.csv`. Testing days appear newest name
first; use `YYYY-MM-DD` names to keep them chronological. New uploads appear the
next time the picker is opened, without a rebuild. Only non-hidden, regular CSV
files directly inside day folders are offered. Symlinks are not followed.

The repository contains no telemetry. Actual testdata contents and `.env` files
are ignored by Git; upload CSVs directly to private server storage. Never put
private CSVs in `public/`, `dist/`, or a public Git repository. The original main
website can serve repository files, so committing CSVs there would bypass this
data server's protection.

Both the catalog and file downloads require a signed, HttpOnly, SameSite=Strict
cookie valid for one hour. Production cookies are HTTPS-only. The password and
session secret are server environment variables, never `VITE_` variables. There
is no default password or account system. Changing either secret and restarting
invalidates existing sessions. The picker reuses a valid session when reopened,
including after a page refresh, and asks for the password only if the session is
missing or expired. Responses from the API are marked `no-store`.

Five incorrect passwords from a client IP trigger a five-minute lockout, including
attempts with the correct password during that period. The dialog shows remaining
attempts and a countdown. Closing the dialog, refreshing, clearing cookies, or
restarting the server does not reset the lockout. Successful authentication resets
the failure count; incomplete sequences also expire after 24 hours of inactivity.
People sharing a public IP share the attempt budget. A new network/IP has a
separate budget. Existing authorized sessions last until their normal expiry.

Signed-in members can upload one or more CSVs from the online-data dialog. Each
queued file has an editable testing date and destination filename before upload.
Each upload is limited to 25 MB and is written atomically to the selected
testing-day folder, so a partial upload never appears in the catalog. Uploading
the same name again replaces that file. The lower-left server-file library also
supports authenticated date changes, rename, delete, download, refresh, and open
actions.

Lockout state is stored in `testdata/.auth/attempts.json`. Run one server process
and one instance, with this folder on persistent storage. Do not run multiple
workers against this file; multiple instances would require a shared transactional
store. `ERPL_TESTDATA_DIR` can override the data root if your host uses another
private disk path. Back up the CSVs separately.

## Real-time telemetry and machine uploads

Set `ERPL_INGEST_TOKEN` to a separate random secret of at least 32 characters.
Data-acquisition systems use this token as an HTTP Bearer credential; they never
receive the shared viewer password or browser session cookie.

Upload a completed CSV directly from a DAQ machine:

```bash
curl --fail-with-body \
  -X PUT \
  -H "Authorization: Bearer $ERPL_INGEST_TOKEN" \
  -H "Content-Type: text/csv" \
  --data-binary @hot-fire-01.csv \
  "https://data.erpl.space/api/ingest/csv/2026-09-21/hot-fire-01.csv"
```

Publish a live telemetry sample:

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $ERPL_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"timestamp":"2026-09-21T01:02:03Z","values":{"pressure (psi)":725.4,"valve_open":true},"event":"ignition"}' \
  "https://data.erpl.space/api/ingest/streams/test-stand"
```

Samples are appended as NDJSON under `testdata/.live/<stream>/<UTC-day>.ndjson`
on the persistent disk. Signed-in dashboards can discover streams at
`GET /api/online/streams` and subscribe to
`GET /api/online/streams/<stream>/events`. The latter is a Server-Sent Events
feed with `ready` and `sample` events, a 15-second keepalive, and a one-hour
maximum connection lifetime. SSE works over ordinary HTTPS through Render and
Cloudflare and automatically reconnects in browsers. The live archive is hidden
from the CSV catalog and is never served as a static path.

DAQ publishers should normally send one sample per second. The endpoint accepts
samples immediately, while the Datanator browser batches rendering to one update
per second and retains the most recent 7,200 samples (two hours at 1 Hz) in the
current browser session. Closing the Live dialog does not stop an active stream;
use **Disconnect** when the subscription should end.

The ingest API accepts at most 256 channels per sample. Values may be finite
numbers, booleans, null, or strings up to 512 characters. Rotate the ingest token
immediately if it is exposed. For higher write volume, multiple server instances,
or guaranteed delivery across outages, move the live stream to a dedicated
message broker/time-series database; the current disk-backed design intentionally
runs as one Render instance.

## Render deployment

The old `erpl-data` service is a **static site**, which cannot enforce password
checks on file downloads. The root `render.yaml` now describes a replacement
Node web service, `erpl-data-server`, with a persistent disk. Applying this
Blueprint does not convert the old manually created static site. The main
`erpl.space` service is separate.

1. Provision the replacement web service with the Blueprint, or use these settings:
   - Build: `cd subdomains/data && npm ci --include=dev && npm run build`
   - Start: `cd subdomains/data && npm start`
   - Node: `22.12.0`; `NODE_ENV=production`
   - Set `ERPL_DATA_PASSWORD` to your chosen shared password.
   - Set `ERPL_SESSION_SECRET` to a random secret of at least 32 characters
     (the Blueprint generates it).
   - Set `ERPL_INGEST_TOKEN` to a different random secret of at least 32
     characters (the Blueprint generates it).
   - Attach a persistent disk at
     `/opt/render/project/src/subdomains/data/testdata`.
   - Set `TRUST_PROXY_HOPS=1` for a single trusted proxy in front of the server.
     Verify the actual proxy path before launch; do not trust arbitrary forwarded
     headers or expose the process directly while proxy trust is enabled.
2. Upload CSVs from the authenticated online-data dialog or the token-protected
   machine endpoint above. For bulk migration, SSH/SCP remains available through
   the service's Render Connect menu; copy day folders under
   `/opt/render/project/src/subdomains/data/testdata/`.
3. Test the replacement's `onrender.com` URL: wrong password, fifth-attempt
   lockout, correct password after five minutes, day selection, and CSV plotting.
   Confirm requests from different networks get separate attempt budgets and that
   `/testdata/<day>/<file>.csv` returns 404 even when authenticated.
4. Remove `data.erpl.space` from the old static service, add it to the new web
   service, and update its DNS CNAME to the new Render hostname. Verify HTTPS,
   then retire the old data static service when the replacement works.

The Blueprint intentionally leaves the custom domain out until the replacement
has been verified. A paid web service and persistent disk are required for this
Render configuration; no services are provisioned by this code change.
See [Render web services](https://render.com/docs/web-services),
[persistent disks](https://render.com/docs/disks), and
[Express proxy configuration](https://expressjs.com/en/guide/behind-proxies/).

## Checks

```bash
npm test
npm run build
```

The server integration tests cover unauthenticated access, lockout timing and
restart persistence, session expiry/tampering, proxy header spoofing, traversal,
symlinks, production configuration, and successful CSV downloads. Test data is
generated in temporary directories and removed when each test finishes.

## Plotting

Click a channel to add it to the active plot. Drag a channel onto a plot to
target that pane. Series that share a unit share an axis; use **⧉** on a legend
chip to give a series its own scale. **Add plot** stacks another time-synced pane.

## Zoom and views

- **Pan** (shortcut `1`): drag to move in time. Mouse wheel zooms around the cursor.
- **Zoom** (shortcut `2`): drag a time window. Double-click or **Fit** (`F`) restores the full span.
- The bottom brush is the full campaign window; drag it or its edges to select a view.
- Name the current window under **Views** to jump back later.

## Measure

Click **Measure** (`3` or `M`), then click two or more times on a plot. Each pair
of cursors draws a chord on every visible series. The inspector lists:

- **ΔX** — time between those points
- **ΔY** — change on each series
- **Slope** — ΔY / ΔX in that series' units per second

Drag a cursor to move it. Right-click a cursor to remove it. Escape clears
cursors and returns to pan.
