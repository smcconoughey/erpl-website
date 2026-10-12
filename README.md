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

### Data server deployment

Online ERPL data requires the Node server in `subdomains/data/server/` so that
both the test-day catalog and CSV downloads are password protected. Private CSVs
belong in `subdomains/data/testdata/<testing-day>/` on the server, never in the
public website or Git history.

The root `render.yaml` describes a replacement Node web service for the existing
`erpl-data` static site, with persistent storage. See
[subdomains/data/README.md](subdomains/data/README.md#render-deployment) for the
shared-password configuration, CSV uploads, and custom-domain migration steps.
The main `erpl.space` service is managed separately.
