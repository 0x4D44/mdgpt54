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

## Live aircraft (OpenSky proxy)

Two OpenSky constraints make live aircraft impossible to fetch browser-direct:
1. **CORS** — OpenSky returns `Access-Control-Allow-Origin: https://opensky-network.org`, so a browser
   on any other origin (GitHub Pages, `localhost`) is blocked.
2. **Per-IP anonymous rate limit** — anonymous access is ~400 req/day per IP; shared datacenter IPs
   (e.g. a serverless proxy's egress) are permanently over quota, so OpenSky drops the connection (522).

Fix: deploy `worker/opensky-proxy.js` (a stateless Cloudflare Worker — paste-and-deploy, no build) and
give it OpenSky **OAuth2 client credentials** so its requests are authenticated (account-based ~4000/day,
served regardless of egress IP):

1. OpenSky account → **Account → API clients** → create a client → copy the `client_id`/`client_secret`.
2. In the Worker → **Settings → Variables and Secrets**, add secrets `OPENSKY_CLIENT_ID` and
   `OPENSKY_CLIENT_SECRET`, then redeploy. (Without them the worker falls back to anonymous, which 522s
   from datacenter IPs.)
3. Build the site pointed at the worker:

```powershell
$env:VITE_OPENSKY_BASE = "https://worldviewer-opensky.<subdomain>.workers.dev"; npm run build
```

The client routes both OpenSky endpoints (`/api/states/all`, `/api/routes`) through this base; if
`VITE_OPENSKY_BASE` is unset it falls back to OpenSky directly. The CSP already allows
`https://*.workers.dev`.

## Stack

- MapLibre GL JS for globe rendering and camera control
- OpenFreeMap vector tiles and labels
- EOX Sentinel-2 Cloudless imagery for realistic satellite texture
- AWS Terrain Tiles / Terrarium DEM for terrain and relief
- OpenStreetMap Nominatim search for lightweight geocoding
- OpenSky for live aircraft, via a small same-origin CORS proxy (see "Live aircraft" above)
- OpenSky aircraft metadata snapshots for static aircraft identity shards

## Notes

- This is the realistic open-data version of the feature. It reaches street-scale navigation with terrain, roads, labels, and extruded buildings, but it is not worldwide photogrammetry.
- Live traffic is intended for personal, non-commercial use and depends on public community feeds. Coverage and freshness vary by region and provider.
- This build targets GitHub Pages: the static globe and aircraft identity need no server. Live aircraft additionally need the small OpenSky CORS proxy described above (OpenSky no longer allows browser-direct cross-origin fetches).
- At higher zoom and pitch, airborne aircraft switch from 2D symbols to bounded 3D class models in the browser. This only activates when the visible airborne aircraft count stays low enough to keep the map responsive.
- The external services above are public community/demo services. For sustained production traffic, swap them for self-hosted or contracted equivalents.

## Credits

- MapLibre GL JS
- OpenFreeMap
- EOX Maps Sentinel-2 Cloudless
- AWS Terrain Tiles / Terrarium
- OpenStreetMap Nominatim
- OpenSky Network for live aircraft state vectors and aircraft metadata snapshots
