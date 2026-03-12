# Worldviewer

Browser-based Earth twin built with MapLibre GL JS. It starts in orbit, supports globe projection, terrain, 3D buildings, location search, and cinematic fly-to jumps into street-scale views.

## Run

```powershell
npm install
npm run dev
```

`npm run dev` now starts both Vite and the local traffic relay. If you only want the frontend dev server, use `npm run dev:web`.

## Aircraft Metadata Refresh

Aircraft identity shards are generated from the public OpenSky aircraft metadata snapshots. Download a complete monthly CSV into a local scratch folder, then run:

```powershell
npm run refresh:aircraft-identity -- --input tmp/aircraft-database-complete-2025-08.csv
```

This writes 256 JSON shards under `public/aircraft-identity/`, keyed by the first two hex characters of `icao24` (`00.json` .. `ff.json`), and logs each shard's raw and gzip size so the guardrails are visible before commit.

## Configuration

- `AISSTREAM_API_KEY`: optional, enables the live ship layer. If it is missing, aircraft still work and ships stay unavailable in the UI.

## Stack

- MapLibre GL JS for globe rendering and camera control
- OpenFreeMap vector tiles and labels
- EOX Sentinel-2 Cloudless imagery for realistic satellite texture
- AWS Terrain Tiles / Terrarium DEM for terrain and relief
- OpenStreetMap Nominatim search for lightweight geocoding
- OpenSky direct from the browser for live aircraft
- OpenSky aircraft metadata snapshots for static aircraft identity shards
- AISStream via the local relay for live ships

## Notes

- This is the realistic open-data version of the feature. It reaches street-scale navigation with terrain, roads, labels, and extruded buildings, but it is not worldwide photogrammetry.
- Live traffic is intended for personal, non-commercial use and depends on public community feeds. Coverage and freshness vary by region and provider.
- GitHub Pages can host the static globe build and live aircraft, because live aircraft and static aircraft identity both come from OpenSky-compatible browser/static paths. Live ships still need a relay, so the ship toggle stays unavailable on the Pages build.
- The external services above are public community/demo services. For sustained production traffic, swap them for self-hosted or contracted equivalents.

## Credits

- MapLibre GL JS
- OpenFreeMap
- EOX Maps Sentinel-2 Cloudless
- AWS Terrain Tiles / Terrarium
- OpenStreetMap Nominatim
- OpenSky Network for live aircraft state vectors and aircraft metadata snapshots
- AISStream for live ship traffic
