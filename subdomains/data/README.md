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

Open the URL Vite prints (usually http://localhost:5173).

## Load data

- **Open folder / Open files** — pick any nested set of CSVs on disk.
- Drag and drop files or folders onto the window.

Time is taken from `elapsed_s` when present, otherwise from a timestamp column.
Numeric channels are grouped (pressure, load, temperature, discrete, bang-bang).
Event strings become markers on the plot.

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
