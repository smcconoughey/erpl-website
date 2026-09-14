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

`subdomains/data/index.html` is an intentionally blank page for
`https://data.erpl.space/`. It has no scripts or external dependencies, and
search indexing is disabled. The existing `data/` directory contains the main
website's JSON content and is not the data subdomain's publish directory.

### Render service

The `erpl-data` static site was created directly in Render on September 14, 2026,
and its initial deployment is live at https://erpl-data.onrender.com/.

- Dashboard: https://dashboard.render.com/static/srv-dajun1qd0e5s73dqcgt0
- Service ID: `srv-dajun1qd0e5s73dqcgt0`
- Branch: `main`, with automatic deployment enabled
- Build command: `test -f subdomains/data/index.html`
- Publish directory: `./subdomains/data`

Edit files inside `subdomains/data/` and merge into `main` to deploy changes.

`render.yaml` records the intended separate data-site configuration, including
the custom domain and an indexing header. The service was created directly;
the Blueprint has not been applied and its domain/header declarations are not
active. Do not create another service from the Blueprint as an activation step.
The existing main website service is managed separately.

### Remaining custom-domain activation

The Render service is live, but the custom-domain association and DNS setup
have not been completed or verified.

1. Open the data service's Render dashboard above. In **Settings > Custom
   Domains**, add `data.erpl.space`.
2. At the DNS provider for `erpl.space`, create a `CNAME` record with name
   `data` and target `erpl-data.onrender.com`.
3. In Render, click **Verify** for `data.erpl.space` and confirm HTTPS is ready.
4. Open `https://data.erpl.space/` and confirm it returns the blank page.

See Render's [custom domain instructions](https://render.com/docs/custom-domains).
