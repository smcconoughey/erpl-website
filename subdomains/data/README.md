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
- **Open Online ERPL Data** — enter the shared password, then choose CSVs from
  one or more testing days. Each day has a Select all checkbox. Selected files
  are added to the same workspace and parsed just like local files. Reopening the
  picker reuses your sign-in and checks files already open in the workspace. Those
  files stay selected and are not downloaded or added again. Remove a file from
  the workspace (or use Clear) to make it available for loading again. Local files
  with matching names are kept separate from online files.

Time is taken from `elapsed_s` when present, otherwise from a timestamp column.
Numeric channels are grouped (pressure, load, temperature, discrete, bang-bang).
Event strings become markers on the plot.

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

Lockout state is stored in `testdata/.auth/attempts.json`. Run one server process
and one instance, with this folder on persistent storage. Do not run multiple
workers against this file; multiple instances would require a shared transactional
store. `ERPL_TESTDATA_DIR` can override the data root if your host uses another
private disk path. Back up the CSVs separately.

## Render deployment

The old `erpl-data` service is a **static site**, which cannot enforce password
checks on file downloads. The root `render.yaml` now describes a replacement
Node web service, `erpl-data-server`, with a persistent disk. Applying this
Blueprint does not convert the old manually created static site. The main
`erpl.space` service is separate.

1. Provision the replacement web service with the Blueprint, or use these settings:
   - Build: `cd subdomains/data && npm ci && npm run build`
   - Start: `cd subdomains/data && npm start`
   - Node: `22.12.0`; `NODE_ENV=production`
   - Set `ERPL_DATA_PASSWORD` to your chosen shared password.
   - Set `ERPL_SESSION_SECRET` to a random secret of at least 32 characters
     (the Blueprint generates it).
   - Attach a persistent disk at
     `/opt/render/project/src/subdomains/data/testdata`.
   - Set `TRUST_PROXY_HOPS=1` for a single trusted proxy in front of the server.
     Verify the actual proxy path before launch; do not trust arbitrary forwarded
     headers or expose the process directly while proxy trust is enabled.
2. Upload day folders and CSVs to that disk through the host's SSH/SCP access.
   For example, from your machine, replace the SSH destination with the one in
   Render's Connect menu:
   `scp -r ./2026-09-19 USER@SSH_HOST:/opt/render/project/src/subdomains/data/testdata/`
   Uploads go directly to server storage, not through a public upload endpoint.
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
