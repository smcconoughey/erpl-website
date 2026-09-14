# ERPL Website

Experimental Rocket Propulsion Lab website.

## Deployment

This site is automatically deployed to Render when changes are pushed to the `main` branch.

## Local Development

```bash
# Start local server
python3 -m http.server 8000
```

Then open http://localhost:8000

## Domain Setup

The site is configured to use `erpl.space` as a custom domain through Render.

## Data Subdomain

`subdomains/data/` is **Datanator**, the ERPL CSV campaign viewer published at
`https://data.erpl.space/`. Search indexing is disabled. The existing `data/`
directory contains the main website's JSON content and is not the data
subdomain's publish directory.

### Local development

```bash
cd subdomains/data
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Open a folder of CSVs
or drop files onto the window to plot channels against time.

### Render service

The `erpl-data` static site was created directly in Render on September 14, 2026,
and is live at https://erpl-data.onrender.com/.

- Dashboard: https://dashboard.render.com/static/srv-dajun1qd0e5s73dqcgt0
- Service ID: `srv-dajun1qd0e5s73dqcgt0`
- Branch: `main`, with automatic deployment enabled

Datanator is a Vite app. The live service was created in the dashboard, not
from this Blueprint. **Merging to `main` without updating those two dashboard
fields ships Vite source (`/src/main.tsx`) and the tool will not load.**

- Build command: `cd subdomains/data && npm ci && npm run build`
- Publish directory: `./subdomains/data/dist`
- Environment: `NODE_VERSION=22.12.0` (Vite 7 requires Node `^20.19` or `>=22.12`)

Do not create another service from the Blueprint as an activation step. The
existing main website service is managed separately.

### Remaining custom-domain activation

The Render service is live, but the custom-domain association and DNS setup
have not been completed or verified.

1. Open the data service's Render dashboard above. In **Settings > Custom
   Domains**, add `data.erpl.space`.
2. At the DNS provider for `erpl.space`, create a `CNAME` record with name
   `data` and target `erpl-data.onrender.com`.
3. In Render, click **Verify** for `data.erpl.space` and confirm HTTPS is ready.
4. Open `https://data.erpl.space/` and confirm Datanator loads.

See Render's [custom domain instructions](https://render.com/docs/custom-domains).
