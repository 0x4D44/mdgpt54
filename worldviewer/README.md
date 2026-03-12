# Worldviewer

Browser-based Earth twin built with MapLibre GL JS. It starts in orbit, supports globe projection, terrain, 3D buildings, location search, and cinematic fly-to jumps into street-scale views.

## Run

```powershell
npm install
npm run dev
```

`npm run dev` now starts both Vite and the local traffic relay. If you only want the frontend dev server, use `npm run dev:web`.

## Configuration

- `AISSTREAM_API_KEY`: optional, enables the live ship layer. If it is missing, aircraft still work and ships stay unavailable in the UI.

## Stack

- MapLibre GL JS for globe rendering and camera control
- OpenFreeMap vector tiles and labels
- EOX Sentinel-2 Cloudless imagery for realistic satellite texture
- AWS Terrain Tiles / Terrarium DEM for terrain and relief
- OpenStreetMap Nominatim search for lightweight geocoding
- OpenSky direct from the browser for live aircraft
- AISStream via the local relay for live ships

## Notes

- This is the realistic open-data version of the feature. It reaches street-scale navigation with terrain, roads, labels, and extruded buildings, but it is not worldwide photogrammetry.
- Live traffic is intended for personal, non-commercial use and depends on public community feeds. Coverage and freshness vary by region and provider.
- GitHub Pages can host the static globe build and live aircraft, because aircraft now come direct from OpenSky in the browser. Live ships still need a relay, so the ship toggle stays unavailable on the Pages build.
- The external services above are public community/demo services. For sustained production traffic, swap them for self-hosted or contracted equivalents.
