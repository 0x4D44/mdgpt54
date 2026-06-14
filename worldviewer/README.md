# Worldviewer

Browser-based Earth twin built with MapLibre GL JS. It starts in orbit, supports globe projection, terrain, 3D buildings, location search, and cinematic fly-to jumps into street-scale views.

## Run

```powershell
npm install
npm run dev
```

`npm run dev` starts the Vite dev server.

## Validate

```powershell
npm run check
```

`npm run check` is the routine whole-repo validation path. It runs the client and scripts TypeScript checks, then the Vitest suite. If you only need the browser app typecheck, use `npm run check:client`.

## Aircraft Metadata Refresh

Aircraft identity shards are generated from the public OpenSky aircraft metadata snapshots. Download a complete monthly CSV into a local scratch folder, then run:

```powershell
npm run refresh:aircraft-identity -- --input tmp/aircraft-database-complete-2025-08.csv
```

This writes 256 JSON shards under `public/aircraft-identity/`, keyed by the first two hex characters of `icao24` (`00.json` .. `ff.json`), and logs each shard's raw and gzip size so the guardrails are visible before commit.

## Stack

- MapLibre GL JS for globe rendering and camera control
- OpenFreeMap vector tiles and labels
- EOX Sentinel-2 Cloudless imagery for realistic satellite texture
- AWS Terrain Tiles / Terrarium DEM for terrain and relief
- OpenStreetMap Nominatim search for lightweight geocoding
- OpenSky direct from the browser for live aircraft
- OpenSky aircraft metadata snapshots for static aircraft identity shards

## Notes

- This is the realistic open-data version of the feature. It reaches street-scale navigation with terrain, roads, labels, and extruded buildings, but it is not worldwide photogrammetry.
- Live traffic is intended for personal, non-commercial use and depends on public community feeds. Coverage and freshness vary by region and provider.
- This build targets GitHub Pages: the static globe, live aircraft, and aircraft identity all come from OpenSky-compatible browser/static paths, so no server is required.
- At higher zoom and pitch, airborne aircraft switch from 2D symbols to bounded 3D class models in the browser. This only activates when the visible airborne aircraft count stays low enough to keep the map responsive.
- The external services above are public community/demo services. For sustained production traffic, swap them for self-hosted or contracted equivalents.

## Credits

- MapLibre GL JS
- OpenFreeMap
- EOX Maps Sentinel-2 Cloudless
- AWS Terrain Tiles / Terrarium
- OpenStreetMap Nominatim
- OpenSky Network for live aircraft state vectors and aircraft metadata snapshots
