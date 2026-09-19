# Private test data

Upload CSVs here on the server, in one folder per testing day:

```
testdata/
  2026-09-19/
    hot-fire-01.csv
    cold-flow-01.csv
  2026-10-03/
    hot-fire-02.csv
```

These names are examples; no real telemetry is included. The authenticated picker
discovers folders and CSVs automatically, without a manifest or rebuild. Empty
folders, hidden files, and symbolic links are excluded.

Do not commit actual test data: this repository may be public. All contents except
this README are ignored by Git. Never copy data into `public/` or `dist/`.
The server also keeps its private lockout state in `.auth/` here.

See `../README.md` for deployment, disk persistence, and password configuration.
