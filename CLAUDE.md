# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

Single project: `worldviewer/` — a browser-based Earth twin built with MapLibre GL JS, Three.js, and real-time open-data feeds. The repo root contains only this subdirectory. All commands run from `worldviewer/`.

## Commands

All commands assume `cd worldviewer/`.

```bash
npm install                  # install dependencies
npm run dev                  # Vite dev server + ship traffic relay (concurrently)
npm run dev:web              # Vite only (no relay, aircraft still work)
npm run dev:relay            # relay only (ships via AISStream WebSocket)

npm run check                # full validation: typecheck (client + scripts + server) + vitest
npm run check:client         # typecheck browser code only (src/)
npm run check:scripts        # typecheck scripts/ only
npm run check:server         # typecheck server/ only

npm run test                 # vitest run (unit tests, one-shot)
npx vitest run src/traffic/trafficHelpers.test.ts   # single test file

npm run test:e2e             # playwright e2e (auto-starts vite on :5173)
npm run test:e2e:ui          # playwright interactive UI mode
npx playwright test --config e2e/playwright.config.ts -g "search"  # single e2e by grep

npm run build                # typecheck + vite build → dist/
```

Docker (ships require `AISSTREAM_API_KEY` env var):
```bash
docker compose up --build    # relay on :3210 (internal), nginx on :8080
```

## Architecture

### Data flow

User interactions and map events mutate a plain `MapState` object (`src/mapState.ts`). `sceneSync.ts` reads MapState on every map move/idle and reconciles MapLibre's rendering state (terrain exaggeration, projection mode, layer visibility, satellite opacity). No state management library — just a mutable object passed to sync functions.

### Two rendering engines

**MapLibre GL JS** handles all 2D map rendering: vector tiles, raster imagery, terrain mesh, symbol layers, GeoJSON overlays, popups. **Three.js** is used only for 3D aircraft models at high zoom/pitch via a custom MapLibre layer (`aircraft3dLayer.ts` / `aircraft3d.ts`). Three.js is lazy-loaded and only activates when airborne aircraft count is low enough to maintain frame rate.

### Traffic dual-transport

Aircraft and ships use different data paths:
- **Aircraft**: Browser polls OpenSky API directly (no server needed). `openskyDirect.ts` builds bbox queries; `trafficClient.ts` manages 15-second polling.
- **Ships**: Browser connects via WebSocket to `server/trafficRelay.ts` (port 3210), which maintains a single AISStream connection and fans out bbox-filtered snapshots every 5 seconds.

Both converge in `trafficClient.ts` → `trafficLayers.ts` (2D MapLibre symbols) and optionally `aircraft3dLayer.ts` (3D meshes).

### Projection switching

Globe projection at zoom <= 5, mercator at zoom >= 6, with hysteresis in between. Solar terminator overlay only renders in globe mode. Terrain exaggeration follows a zoom-dependent curve defined in `reliefProfile.ts`.

### Overlay modules

Each overlay (`src/overlays/`) is self-contained: solar terminator, weather radar (RainViewer), earthquakes (USGS), ISS tracker, measure tool. They poll on independent intervals and write to their own MapLibre sources.

### Shared types

`src/traffic/trafficTypes.ts` is imported by both browser code and the server relay. The Dockerfile explicitly copies this file into the relay stage.

### Three TypeScript projects

- `tsconfig.json` — browser client (`src/`)
- `scripts/tsconfig.json` — build scripts
- `server/tsconfig.json` — relay server

`npm run check:types` runs all three.

## Testing

- **Unit tests**: Vitest, co-located as `*.test.ts` files alongside source in `src/`.
- **E2E tests**: Playwright (Chromium headless), specs in `e2e/*.spec.ts`. Mock APIs in `e2e/mock-apis.ts` stub all external services (tiles, Nominatim, OpenSky, USGS, RainViewer). `e2e/mock-ship-relay.ts` provides a WebSocket mock for traffic relay tests.
- E2e config: `e2e/playwright.config.ts` — 30s timeout, 1 retry, auto-starts `npm run dev:web`.

## Key conventions

- Entry point is `src/main.ts`, which renders the full HTML shell and wires all modules.
- No framework (React, Vue, etc.) — vanilla TypeScript with direct DOM manipulation.
- URL hash encodes camera state for shareable links (`cameraHash.ts`).
- Bookmarks stored in localStorage (max 24).
- Performance mode (`detailProfile.ts`) hides dense POI/road layers at high zoom + pitch.
- `public/aircraft-identity/` contains 256 JSON shards keyed by first two hex chars of icao24. Regenerate with `npm run refresh:aircraft-identity -- --input <csv>`.

## Environment

- `AISSTREAM_API_KEY` — optional, enables live ship layer. Without it, aircraft still work; ship toggle shows unavailable.
- `TRAFFIC_PORT` — relay listen port (default 3210).
- Vite dev server proxies `/traffic` WebSocket to `localhost:3210`.
