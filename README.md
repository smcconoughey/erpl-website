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

`render.yaml` defines a separate Render static site named `erpl-data`, publishing
only `subdomains/data` from `main`. This Blueprint does not manage the existing
main website service.

### One-time activation

Adding this file to GitHub alone does not create a Render service or a DNS record.

1. In Render, create a Blueprint from this repository using `render.yaml` on
   `main`, and deploy the `erpl-data` static site.
2. At the DNS provider for `erpl.space`, create a `CNAME` record named `data`
   pointing to the actual `onrender.com` hostname assigned to that new service.
   Copy the target from Render; do not point it at the main website service.
3. In the new service's Render settings, verify `data.erpl.space` under Custom
   Domains and confirm HTTPS is available.
4. Open `https://data.erpl.space/` and confirm it returns the blank page.

Subsequent pushes to `main` automatically deploy the data site after activation.

See Render's [Blueprint reference](https://render.com/docs/blueprint-spec) and
[custom domain instructions](https://render.com/docs/custom-domains).
