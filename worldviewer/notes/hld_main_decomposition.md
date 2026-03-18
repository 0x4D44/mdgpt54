# HLD: Decomposition of `src/main.ts`

**Date:** 2026-03-16
**Author:** Claude (Opus 4.6)
**Status:** Draft for review
**Scope:** Extract `src/main.ts` (1,449 lines) into focused, testable modules

---

## Context

`src/main.ts` is the entry point and orchestrator for the entire application. It currently handles map initialization, style construction, UI wiring, search, presets, terrain toggling, overlay management, traffic lifecycle, and telemetry display. It has **no tests** and many responsibilities. The code review identified this as the single largest risk in the codebase.

The rest of the codebase is well-decomposed: `trafficClient.ts`, `trafficUI.ts`, `trafficLayers.ts`, `trafficRuntime.ts`, `searchRequestController.ts`, and the overlay modules all demonstrate the project's existing pattern for focused modules with pure logic + side-effect orchestration separation. This refactoring applies that same pattern to the monolith.

## What Matters

- Each extracted module should be independently testable without a real MapLibre instance.
- The running application must behave identically after each extraction step (no user-visible changes).
- Shared mutable state must be explicitly modeled, not left as implicit module-level variables.
- The resulting `main.ts` should be a thin orchestrator under ~150 lines.

## Non-Goals

- Introducing a state management framework (Redux, signals, etc.).
- Building a generic plugin/module system.
- Changing the HTML structure or CSS.
- Adding new features or changing behavior.

---

## 1. Current Responsibility Inventory

### Line-by-line breakdown of `src/main.ts`

| Lines | Responsibility | Testability | Dependencies |
|-------|---------------|-------------|--------------|
| 1-56 | Imports | -- | 8 internal modules, 2 external libs |
| 58-120 | Type definitions (`Preset`, `SearchResult`, `MapState`, `StyleSource`, `StyleLayer`, `StyleSpec`) | -- | `ProjectionMode` |
| 122-167 | Constants (URLs, layer IDs, label/feature arrays) | -- | none |
| 169-230 | `PRESETS` data array | Pure data | none |
| 232-349 | HTML template (app shell, search form, preset grid, toggle grid, metric section) | -- | `PRESETS` |
| 351-368 | DOM element queries (16 element references) | -- | HTML template |
| 369-396 | Overlay/controller instance creation, `MapState` initialization | -- | `createSearchRequestController`, overlays, `reliefProfile` |
| 397-425 | `bootstrap()` — async entry point orchestrating all wiring | Integration | everything |
| 427-444 | `wireDockToggle()` — sidebar collapse toggle | DOM events | `controlDock`, `dockToggle` |
| 446-681 | `buildStyle()` — fetches base style, merges sources, transforms layers, builds terrain/satellite/contour layers | **Pure-ish** (async fetch + data transforms) | `reliefProfile`, `detailProfile`, `mapState.reliefEnabled` |
| 683-698 | `createMap()` — MapLibre `Map` constructor call | Side effect | `mapContainer`, `MAX_BROWSER_ZOOM` |
| 700-808 | `wireMap()` — event handlers (render, load, idle, movestart, moveend, move, click, error), controls, popup, spin scheduling | Integration | `mapState`, `statusPill`, `activePopup`, `syncViewState`, `spinGlobe` |
| 810-848 | `wireSearch()` — search form submit handler | Integration | `searchInput`, `searchMessage`, `searchResults`, `searchRequests`, `searchPlaces`, `renderSearchResults` |
| 851-873 | `wirePresets()` — preset button click handlers | Integration | `PRESETS`, `map`, `statusPill`, `activePopup` |
| 875-931 | `wireToggles()` — scene toggle dispatch (terrain, relief, buildings, night, weather, spin) | Integration | `mapState`, many helper functions |
| 933-967 | `syncSceneOverlays()`, `renderSceneOverlayPresentation()` — overlay state sync | **Mostly pure** | `mapState`, `solarTerminator`, `weatherRadar` |
| 969-1084 | `wireTraffic()` — traffic lifecycle (UI creation, client creation, toggle handlers, layer addition, moveend) | Integration | `trafficClient`, `trafficUI`, `trafficLayers`, `aircraft3dLayer` |
| 1086-1133 | `renderSearchResults()` — builds search result DOM and wires fly-to | DOM + map | `map`, `statusPill`, `searchResults` |
| 1135-1175 | `searchPlaces()` — Nominatim geocoding fetch + parse | **Pure async** | `NOMINATIM_SEARCH_URL` |
| 1177-1179 | `isAbortError()` — error type guard | **Pure** | none |
| 1181-1203 | `spinGlobe()` — orbit auto-spin animation | Map side effect | `mapState` |
| 1205-1216 | `syncMetrics()` — reads map state, writes DOM metric elements | Mixed | `mapState`, metric DOM elements |
| 1218-1224 | `syncViewState()` — orchestrates terrain/projection/detail/satellite/metrics sync | Integration | everything |
| 1226-1247 | `updateTerrainModel()`, `currentTerrainOptions()` — terrain exaggeration sync | Map side effect | `mapState`, `reliefProfile` |
| 1249-1259 | `updateProjectionMode()` — projection transition | Map side effect | `mapState`, `projectionBehavior` |
| 1261-1284 | `updateDetailProfile()` — performance mode toggle | Map side effect | `mapState`, `detailProfile`, `statusPill` |
| 1286-1304 | `setReliefVisibility()`, `updateSatelliteOpacity()` — relief/satellite paint sync | Map side effect | `reliefProfile` |
| 1306-1324 | `calculateApproxAltitude()`, `getTerrainHeight()` — camera metrics | **Pure** (given map readings) | `mapState` |
| 1326-1344 | `classifyView()` — zoom-to-label mapping | **Pure** | none |
| 1346-1400 | `selectFillOpacity()`, `selectRoadOpacity()` — style expressions | **Pure** | none |
| 1402-1408 | `setLayerVisibility()` — layer visibility helper | Map side effect | none |
| 1410-1448 | `pickString()`, `prettifyLayerName()`, `formatDistance()`, `formatElevation()`, `formatCoordinates()` — formatting utilities | **Pure** | none |

### Responsibility clusters (natural seams)

1. **Style construction** (lines 446-681, 1346-1400): `buildStyle()`, `selectFillOpacity()`, `selectRoadOpacity()`. Self-contained — takes a DEM source and `mapState.reliefEnabled`, returns a `StyleSpecification`.

2. **Search** (lines 810-848, 1086-1175, 1177-1179): `wireSearch()`, `renderSearchResults()`, `searchPlaces()`, `isAbortError()`. Needs `map` for fly-to, `statusPill` for status, and `searchRequests` controller.

3. **Presets** (lines 169-230, 851-873): `PRESETS` data + `wirePresets()`. Needs `map` for fly-to, `statusPill` for status, `activePopup` for cleanup.

4. **Metrics/telemetry** (lines 1205-1216, 1306-1344, 1426-1448): `syncMetrics()`, `calculateApproxAltitude()`, `getTerrainHeight()`, `classifyView()`, `formatDistance()`, `formatElevation()`. Needs `mapState` for terrain state, metric DOM elements for output.

5. **Scene/view sync** (lines 1218-1304, 1402-1408, 1181-1203): `syncViewState()`, `updateTerrainModel()`, `updateProjectionMode()`, `updateDetailProfile()`, `setReliefVisibility()`, `updateSatelliteOpacity()`, `setLayerVisibility()`, `spinGlobe()`. The "glue" that keeps map state, overlays, and visual layers in sync. This is the hardest to extract cleanly.

6. **Traffic** (lines 969-1084): `wireTraffic()`. Already largely delegated — creates a `TrafficClient` and wires its callbacks.

7. **HTML template + DOM queries** (lines 232-368): The template string and 16 `querySelector` calls. These are the "roots" everything else references.

---

## 2. Shared State Analysis

This is the critical constraint. `main.ts` has the following mutable state:

| Variable | Type | Read by | Written by |
|----------|------|---------|------------|
| `mapState` | `MapState` (7 booleans + exaggeration + projectionMode) | `syncViewState`, `syncMetrics`, `syncSceneOverlays`, `wireToggles`, `buildStyle`, `spinGlobe`, `updateTerrainModel`, `updateProjectionMode`, `updateDetailProfile`, `updateSatelliteOpacity`, `getTerrainHeight`, `formatElevation` | `wireToggles`, `updateTerrainModel`, `updateProjectionMode`, `updateDetailProfile` |
| `map` | `Map \| null` | `wirePresets`, `renderSearchResults`, `wireToggles` | `bootstrap` (set once) |
| `activePopup` | `Popup \| null` | `wireMap` click handler, `updateDetailProfile` | `wireMap` click handler, `wirePresets`, `updateDetailProfile` |
| `weatherRadarPresentation` | `WeatherRadarPresentation` | `renderSceneOverlayPresentation` | weather radar callback |
| `solarTerminator` | overlay instance | `syncSceneOverlays` | created once |
| `weatherRadar` | overlay instance | `syncSceneOverlays` | created once |
| `searchRequests` | controller instance | `wireSearch` | created once |

### Key observations

1. **`mapState` is the central shared state.** It's read by ~15 functions and written by ~4. Any module decomposition must give all modules coordinated access to this object.

2. **`map` is read-only after bootstrap.** Set once, then passed or accessed everywhere. The `map` variable is only accessed via closure by `wirePresets`, `renderSearchResults`, and `wireToggles` — everywhere else it's passed as a parameter.

3. **`activePopup` is shared across two concerns** — the map click handler creates popups, and `wirePresets`/`updateDetailProfile` dismiss them. This is a coupling point.

4. **`weatherRadarPresentation` is updated by callback** and read by the overlay presentation renderer. It's effectively a one-way data flow from the overlay to the UI.

5. **Overlay instances and `searchRequests`** are created once and never reassigned. They can be passed as constructor dependencies.

### State ownership strategy

Create a single `MapState` object that is **passed by reference** to all modules that need it. Since JavaScript objects are passed by reference, mutations are visible to all holders. This matches the existing pattern (all code mutates and reads the same `mapState` object today).

Do **not** attempt to make `MapState` immutable or add change listeners yet. That would be a separate future refactoring. The goal here is to make the mutation points explicit, not to change the mutation model.

The `activePopup` state should move into the wireMap/scene-sync concern. Presets dismiss it, which means preset handlers need a `dismissPopup()` callback rather than direct access.

---

## 3. Proposed Module Breakdown

### Module dependency graph

```
main.ts (thin orchestrator, ~120-150 lines)
  |
  +-- appShell.ts           (HTML template + DOM element refs)
  |
  +-- mapStyle.ts            (style spec builder, pure)
  |
  +-- searchUI.ts            (search form, geocoding, result rendering)
  |
  +-- presetUI.ts            (preset data, preset grid wiring)
  |
  +-- metricUI.ts            (telemetry display, formatting, view classification)
  |
  +-- sceneSync.ts           (view state sync: terrain, projection, detail, satellite, relief, spin, overlays)
  |     |
  |     +-- reads/writes MapState
  |     +-- uses overlays (solarTerminator, weatherRadar)
  |     +-- uses reliefProfile, projectionBehavior, detailProfile
  |
  +-- traffic/ (existing)    (already extracted)
```

### 3.1 `src/appShell.ts` — HTML template and DOM references

**Responsibility:** Render the app shell HTML into `#app`, export typed references to all DOM elements.

**Exports:**
```typescript
type AppShellElements = {
  mapContainer: HTMLDivElement;
  statusPill: HTMLDivElement;
  searchForm: HTMLFormElement;
  searchInput: HTMLInputElement;
  searchMessage: HTMLParagraphElement;
  searchResults: HTMLDivElement;
  metricMode: HTMLElement;
  metricZoom: HTMLElement;
  metricAltitude: HTMLElement;
  metricPitch: HTMLElement;
  metricTerrain: HTMLElement;
  controlDock: HTMLElement;
  dockToggle: HTMLButtonElement;
  sceneOverlayNote: HTMLElement;
  sceneOverlayCredit: HTMLElement;
  presetButtons: HTMLButtonElement[];
  toggleButtons: HTMLButtonElement[];
};

function renderAppShell(presets: Preset[]): AppShellElements;
function wireDockToggle(elements: Pick<AppShellElements, 'controlDock' | 'dockToggle'>): void;
```

**Lines moved:** 232-368, 427-444, `Preset` type (58-67).

**Testability:** `renderAppShell` can be tested with jsdom — verify element existence and structure. `wireDockToggle` can be tested by simulating clicks and checking class/attribute changes.

### 3.2 `src/mapStyle.ts` — Style specification builder

**Responsibility:** Fetch the OpenFreeMap base style, merge satellite/terrain/contour sources, transform layers (colors, opacity, labels), return a complete `StyleSpecification`.

**Exports:**
```typescript
type StyleBuildConfig = {
  reliefEnabled: boolean;
  terrainExaggeration: number;
};

function buildMapStyle(
  demSource: DemSource,
  config: StyleBuildConfig
): Promise<StyleSpecification>;

// Pure functions (exported for testing):
function selectFillOpacity(layerId: string): number | unknown[];
function selectRoadOpacity(layerId: string): number | unknown[];
```

**Lines moved:** 89-120 (type definitions), 122-167 (constants), 446-681 (buildStyle), 1346-1400 (selectFillOpacity, selectRoadOpacity).

**Constants moved:** `OPENFREEMAP_STYLE_URL`, `SATELLITE_TILE_URL`, `TERRAIN_TILE_TEMPLATE_URL`, `TERRAIN_ATTRIBUTION`, `BUILDING_LAYER_ID`, `FLAT_BUILDING_LAYER_ID`, `HILLSHADE_LAYER_ID`, `CONTOUR_LINE_LAYER_ID`, `CONTOUR_LABEL_LAYER_ID`, `LABEL_LAYER_IDS`.

**Dependencies:** `reliefProfile` (source IDs, contour thresholds, terrain/hillshade/satellite expressions), `detailProfile` (none — style doesn't use detail profile).

**What stays in main:** `FEATURE_QUERY_LAYERS` (used by wireMap click handler), `BUILDING_LAYER_ID`/`FLAT_BUILDING_LAYER_ID` (used by wireToggles). These constants must be **re-exported** from `mapStyle.ts` or shared.

**Testability:** The `buildMapStyle` function requires a fetch mock for the base style URL. The layer transformation logic can be tested by providing a minimal base style and asserting on the output. `selectFillOpacity` and `selectRoadOpacity` are fully pure.

### 3.3 `src/searchUI.ts` — Search form, geocoding, and result rendering

**Responsibility:** Wire the search form submit, call the Nominatim geocoder, render result buttons, handle fly-to on result click.

**Exports:**
```typescript
type SearchDeps = {
  searchForm: HTMLFormElement;
  searchInput: HTMLInputElement;
  searchMessage: HTMLParagraphElement;
  searchResults: HTMLDivElement;
  statusPill: HTMLDivElement;
  getMap: () => Map | null;
  searchRequests: SearchRequestController;
};

type SearchResult = {
  label: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
};

function wireSearch(deps: SearchDeps): void;

// Pure functions (exported for testing):
function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
function isAbortError(error: unknown): boolean;
function formatCoordinates(lat: number, lng: number): string;
```

**Lines moved:** 69-74 (`SearchResult` type), 810-848 (`wireSearch`), 1086-1133 (`renderSearchResults`), 1135-1179 (`searchPlaces`, `isAbortError`), 1446-1448 (`formatCoordinates`), `NOMINATIM_SEARCH_URL` constant.

**Dependencies:** `escapeHtml`, `searchRequestController`. `map` is accessed via a `getMap()` callback rather than a direct closure reference, keeping the module map-independent.

**Testability:** `searchPlaces` is pure async — mock `fetch` and test the parsing. `isAbortError` and `formatCoordinates` are trivially pure. `wireSearch` can be tested with jsdom by firing submit events and checking DOM changes (with mocked fetch). `renderSearchResults` can be tested by providing results and checking the generated DOM.

### 3.4 `src/presetUI.ts` — Preset data and fly-to wiring

**Responsibility:** Define preset data, wire preset button click handlers for camera fly-to.

**Exports:**
```typescript
type Preset = {
  id: string;
  label: string;
  caption: string;
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

const PRESETS: Preset[];

type PresetDeps = {
  presetButtons: HTMLButtonElement[];
  statusPill: HTMLDivElement;
  getMap: () => Map | null;
  dismissPopup: () => void;
};

function wirePresets(deps: PresetDeps): void;
```

**Lines moved:** 58-67 (`Preset` type), 169-230 (`PRESETS`), 851-873 (`wirePresets`).

**Dependencies:** `map` (via callback), `statusPill`, `activePopup` (via `dismissPopup` callback).

**Testability:** `PRESETS` is pure data. `wirePresets` can be tested with jsdom by simulating button clicks and verifying `flyTo` is called with correct parameters (mock `Map`).

### 3.5 `src/metricUI.ts` — Camera telemetry display

**Responsibility:** Read camera state from the map, compute derived metrics (altitude, view classification), write formatted values to DOM elements.

**Exports:**
```typescript
type MetricElements = {
  metricMode: HTMLElement;
  metricZoom: HTMLElement;
  metricAltitude: HTMLElement;
  metricPitch: HTMLElement;
  metricTerrain: HTMLElement;
};

function syncMetrics(map: Map, elements: MetricElements, terrainEnabled: boolean): void;

// Pure functions (exported for testing):
function calculateApproxAltitude(zoom: number, latitudeDeg: number, viewportHeight: number): number;
function getTerrainHeight(map: Map, terrainEnabled: boolean): number | null;
function classifyView(zoom: number): string;
function formatDistance(meters: number): string;
function formatElevation(meters: number | null, terrainEnabled: boolean): string;
```

**Lines moved:** 1205-1216 (`syncMetrics`), 1306-1344 (`calculateApproxAltitude`, `getTerrainHeight`, `classifyView`), 1426-1444 (`formatDistance`, `formatElevation`).

**Note:** `calculateApproxAltitude` currently takes a `Map` and reads `.getCenter().lat`, `.getZoom()`, and `window.innerHeight`. The extracted version should take primitive arguments (zoom, latitude, viewportHeight) to be pure. The `syncMetrics` wrapper reads these from the map.

**Dependencies:** `reliefProfile` (`normalizeTerrainElevation`).

**Testability:** All pure functions are trivially testable. `classifyView`, `formatDistance`, `formatElevation`, `calculateApproxAltitude` are pure input/output. `getTerrainHeight` needs a map mock but is simple.

### 3.6 `src/sceneSync.ts` — View state synchronization and scene management

**Responsibility:** The reactive "engine" that keeps the map visual state consistent with `MapState` on every view change. This includes terrain exaggeration updates, projection switching, performance mode toggling, satellite opacity adjustment, relief visibility, overlay syncing, and the orbit spin animation.

This is the most complex extraction because it touches the most shared state.

**Exports:**
```typescript
type SceneSyncDeps = {
  mapState: MapState;
  statusPill: HTMLDivElement;
  solarTerminator: { enable(map: Map): void; disable(map: Map): void };
  weatherRadar: { enable(map: Map): void; disable(map: Map): void };
  dismissPopup: () => void;
  onOverlayPresentationChange: () => void;
};

// Called from wireMap on every move/moveend
function syncViewState(map: Map, deps: SceneSyncDeps): void;

// Called from wireToggles
function syncSceneOverlays(map: Map, deps: SceneSyncDeps): void;
function setReliefVisibility(map: Map, visible: boolean): void;
function setLayerVisibility(map: Map, layerId: string, visible: boolean): void;
function spinGlobe(map: Map, mapState: MapState): void;
function currentTerrainOptions(map: Map, mapState: MapState): { source: string; exaggeration: number };

// Called from appShell for overlay presentation rendering
function renderSceneOverlayPresentation(
  sceneOverlayNote: HTMLElement,
  sceneOverlayCredit: HTMLElement,
  nightEnabled: boolean,
  projectionMode: ProjectionMode,
  weatherRadarPresentation: WeatherRadarPresentation
): void;

// Re-export needed constants
const BUILDING_LAYER_ID: string;
const FLAT_BUILDING_LAYER_ID: string;
```

**Lines moved:** 1218-1304 (`syncViewState`, `updateTerrainModel`, `currentTerrainOptions`, `updateProjectionMode`, `updateDetailProfile`, `setReliefVisibility`, `updateSatelliteOpacity`), 1402-1408 (`setLayerVisibility`), 1181-1203 (`spinGlobe`), 933-967 (`syncSceneOverlays`, `renderSceneOverlayPresentation`).

**Dependencies:** `reliefProfile`, `projectionBehavior`, `detailProfile`, `MapState`, overlay instances (via callbacks).

**Testability:** The individual update functions (`updateTerrainModel`, `updateProjectionMode`, `updateDetailProfile`) can be tested with a mock map + `MapState`. `renderSceneOverlayPresentation` is pure DOM. `spinGlobe` needs a mock map. `classifyView`, `setLayerVisibility` are trivial.

### 3.7 `src/main.ts` — Thin orchestrator (remaining)

After all extractions, `main.ts` becomes a ~120-150 line file that:

1. Imports all modules
2. Calls `renderAppShell(PRESETS)` to get DOM elements
3. Creates overlay and controller instances
4. Defines `MapState`
5. Calls `buildMapStyle(demSource, config)`
6. Creates the `Map` instance
7. Calls `wireMap()` (map event handlers — this stays in main or moves to a small `mapEvents.ts`)
8. Calls `wireSearch(deps)`
9. Calls `wirePresets(deps)`
10. Calls `wireToggles()` (toggle dispatch switch — stays in main as the central routing)
11. Calls `syncSceneOverlays(map, deps)`
12. Calls `wireTraffic(map)`

**What stays in `main.ts`:**

- `bootstrap()` orchestration
- `wireMap()` (map control setup + event handler registration — ~70 lines)
- `wireToggles()` (toggle dispatch — ~55 lines)
- `createMap()` (~15 lines)
- `MapState` definition and initialization
- `FEATURE_QUERY_LAYERS` constant (used only by wireMap click handler)

**Note on `wireToggles`:** This function is essentially a switch/dispatch that calls into `sceneSync`, `mapStyle`, and overlay modules. It should stay in main because it's the point where all the modules' APIs converge. Extracting it would just create another file that imports everything main already imports.

**Note on `wireMap`:** This could be extracted to `mapEvents.ts`, but since it's the primary integration point for map events and references many module functions, it's cleaner to keep it in main. It's the "nervous system" connecting map events to module functions.

---

## 4. Interface Contracts Between Modules

### 4.1 `MapState` — the shared state contract

```typescript
// Defined in main.ts or a shared types file
type MapState = {
  terrainEnabled: boolean;
  buildingsEnabled: boolean;
  reliefEnabled: boolean;
  nightEnabled: boolean;
  weatherEnabled: boolean;
  autoSpinEnabled: boolean;
  userInteracting: boolean;
  stressModeActive: boolean;
  terrainExaggeration: number;
  projectionMode: ProjectionMode;
};
```

`MapState` stays as a mutable object reference. The following modules receive it:

| Module | Reads | Writes |
|--------|-------|--------|
| `sceneSync` | all fields | `terrainExaggeration`, `projectionMode`, `stressModeActive`, `userInteracting` |
| `metricUI` | `terrainEnabled` | -- |
| `mapStyle` | `reliefEnabled`, `terrainExaggeration` (at build time only) | -- |
| `main.ts` (wireToggles) | all toggle booleans | all toggle booleans |
| `main.ts` (wireMap) | `stressModeActive`, `userInteracting` | `userInteracting` |

### 4.2 Module-to-module communication

All communication is through **direct function calls** or **callback injection**. No event bus, no pub/sub.

- `main.ts` -> `sceneSync.syncViewState(map, deps)` on every map move
- `main.ts` -> `sceneSync.syncSceneOverlays(map, deps)` on toggle changes
- `main.ts` -> `metricUI.syncMetrics(map, elements, terrainEnabled)` via `syncViewState`
- `main.ts` -> `searchUI.wireSearch(deps)` at bootstrap
- `main.ts` -> `presetUI.wirePresets(deps)` at bootstrap
- weather radar overlay -> `main.ts` via `onStateChange` callback -> `renderSceneOverlayPresentation()`

### 4.3 `activePopup` management

Currently three concerns touch `activePopup`:
- `wireMap` click handler creates it
- `wirePresets` dismisses it before fly-to
- `updateDetailProfile` dismisses it when entering performance mode

**Solution:** Keep `activePopup` in `main.ts`. Expose a `dismissPopup()` function that is passed as a callback to `presetUI` and `sceneSync`. The click handler that creates popups stays in `wireMap()` (which stays in `main.ts`).

```typescript
// In main.ts
let activePopup: Popup | null = null;

const dismissPopup = () => {
  activePopup?.remove();
  activePopup = null;
};
```

---

## 5. Migration Strategy

### Extraction order and rationale

Extract modules in order of **lowest coupling first**. Each step must leave the application fully functional.

#### Step 1: `metricUI.ts` (lowest risk, zero coupling to other new modules)

Extract the pure formatting functions and `syncMetrics`. These functions have no dependencies on other main.ts functions — they only read from `Map` and write to DOM elements.

**What changes in main.ts:** Import `syncMetrics`, `formatElevation`, etc. from `metricUI.ts`. Remove the functions. ~80 lines removed.

**Verification:** Run the app, check telemetry panel updates correctly on zoom/pan/pitch.

#### Step 2: `mapStyle.ts` (self-contained, only called once at bootstrap)

Extract `buildStyle()`, type definitions, style constants, and the opacity functions. This is called once during bootstrap and has no ongoing interaction with other code.

**What changes in main.ts:** Import `buildMapStyle` from `mapStyle.ts`. Remove ~280 lines. Pass `{ reliefEnabled, terrainExaggeration }` config instead of reading `mapState` directly.

**Verification:** App loads with correct style. Satellite imagery, hillshade, contours, buildings, labels all render correctly.

#### Step 3: `searchUI.ts` (clean boundary, own async lifecycle)

Extract search form wiring, geocoding, and result rendering. The search subsystem's only coupling to the rest of main.ts is `map` (for fly-to) and `statusPill` (for status messages).

**What changes in main.ts:** Import `wireSearch` from `searchUI.ts`. Remove ~120 lines. Pass dependencies as a config object.

**Verification:** Search, fly-to, abort-on-new-search all work correctly.

#### Step 4: `presetUI.ts` (trivial extraction)

Extract preset data and wiring. Minimal coupling — just `map`, `statusPill`, and popup dismissal.

**What changes in main.ts:** Import `PRESETS`, `wirePresets` from `presetUI.ts`. Remove ~80 lines.

**Verification:** All preset buttons fly to correct locations.

#### Step 5: `appShell.ts` (HTML template + DOM refs)

Extract the HTML template string and DOM query code. This is straightforward but touches every module (they all need DOM refs). The `renderAppShell` function returns a typed object containing all element references.

**What changes in main.ts:** Import `renderAppShell`, `wireDockToggle` from `appShell.ts`. Remove ~130 lines. All other modules receive their DOM elements as explicit parameters.

**Verification:** App renders correctly. All interactive elements work.

#### Step 6: `sceneSync.ts` (highest coupling, extract last)

Extract the view-state synchronization functions. This is the riskiest step because these functions are called from multiple places and mutate `mapState`.

**What changes in main.ts:** Import `syncViewState`, `syncSceneOverlays`, `setReliefVisibility`, `setLayerVisibility`, `spinGlobe`, `currentTerrainOptions`, `renderSceneOverlayPresentation` from `sceneSync.ts`. Remove ~160 lines.

**Verification:** Terrain exaggeration transitions, projection switching, performance mode, satellite opacity, relief toggle, night/weather overlays, orbit spin — all must work correctly and transition smoothly.

### After all extractions: `main.ts` structure

```typescript
import { renderAppShell, wireDockToggle } from "./appShell";
import { buildMapStyle } from "./mapStyle";
import { wireSearch } from "./searchUI";
import { PRESETS, wirePresets } from "./presetUI";
import { syncMetrics } from "./metricUI";
import {
  syncViewState, syncSceneOverlays, setReliefVisibility,
  setLayerVisibility, spinGlobe, currentTerrainOptions,
  renderSceneOverlayPresentation, BUILDING_LAYER_ID, FLAT_BUILDING_LAYER_ID
} from "./sceneSync";
// ... existing traffic, overlay imports

const elements = renderAppShell(PRESETS);
wireDockToggle(elements);

const mapState: MapState = { /* initial values */ };
let activePopup: Popup | null = null;
const dismissPopup = () => { activePopup?.remove(); activePopup = null; };

// overlay + controller setup
// bootstrap() -> buildMapStyle, createMap, wireMap, wireSearch, wirePresets, wireToggles, syncSceneOverlays, wireTraffic
```

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking the toggle dispatch (wireToggles reads/writes MapState, calls many functions) | Medium | High | Keep wireToggles in main.ts. It's the integration glue and is safest as the orchestrator. |
| Race conditions in overlay enable/disable after extraction | Low | Medium | The overlay lifecycle is already encapsulated in their own modules. SceneSync just calls `enable`/`disable`. |
| `mapState` mutations from wrong module | Medium | Medium | Document which modules may write which fields. Consider `Object.freeze` on fields that should be read-only per-module (future). |
| Missing `this` binding or closure capture after refactoring | Medium | Low | All functions in main.ts are already plain functions (no classes). The extraction preserves this pattern. |
| DOM element reference errors from appShell extraction | Low | Low | TypeScript non-null assertions will catch missing elements at compile time. |
| Performance regression from extra function call overhead | Very Low | Very Low | JavaScript engines inline function calls aggressively. No measurable impact expected. |
| Merge conflicts with concurrent work | Medium | Medium | Extract one module at a time, commit after each. Keep PRs focused. |

### The `MapState` mutation problem (the real risk)

The biggest long-term risk is that `MapState` is a bag of mutable fields that any module can read or write. After extraction, the mutation points become:

- `main.ts wireToggles`: toggles the 6 boolean flags
- `main.ts wireMap`: sets `userInteracting`
- `sceneSync.updateTerrainModel`: sets `terrainExaggeration`
- `sceneSync.updateProjectionMode`: sets `projectionMode`
- `sceneSync.updateDetailProfile`: sets `stressModeActive`

This is manageable today (5 writers, clear ownership) but would become problematic if new features add more state. A future follow-up could introduce a minimal state container with explicit mutation functions, but that's out of scope for this refactoring.

---

## 7. Test Plan

### 7.1 `metricUI.test.ts`

| Test | Type | What it verifies |
|------|------|------------------|
| `classifyView` returns correct label for each zoom range boundary | Pure unit | Zoom breakpoints at 3, 7, 11, 14 |
| `formatDistance` formats meters and km correctly | Pure unit | `999m` -> `"999 m"`, `1000m` -> `"1.0 km"` |
| `formatElevation` returns "Off" when terrain disabled | Pure unit | Edge case |
| `formatElevation` returns "--" when meters is null | Pure unit | Edge case |
| `formatElevation` returns rounded meters when valid | Pure unit | `123.6` -> `"124 m"` |
| `calculateApproxAltitude` scales with zoom level | Pure unit | Higher zoom = lower altitude |
| `calculateApproxAltitude` adjusts for latitude | Pure unit | Polar vs equatorial |
| `syncMetrics` writes formatted values to DOM elements | DOM unit | Mock map, check element textContent |

### 7.2 `mapStyle.test.ts`

| Test | Type | What it verifies |
|------|------|------------------|
| `selectFillOpacity` returns water-specific stops for "water" layer | Pure unit | Correct expression structure |
| `selectFillOpacity` returns default stops for other layers | Pure unit | Correct expression structure |
| `selectRoadOpacity` returns casing-specific stops for casing layers | Pure unit | Pattern matching |
| `selectRoadOpacity` returns default road stops for fill layers | Pure unit | Pattern matching |
| `buildMapStyle` merges sources correctly | Async unit (mock fetch) | satellite, terrain-mesh, terrain-relief-dem, contour sources present |
| `buildMapStyle` transforms background color | Async unit | `background-color: "#050b14"` |
| `buildMapStyle` inserts satellite layer after background | Async unit | Layer order |
| `buildMapStyle` inserts contour layers before road_area_pattern | Async unit | Layer insertion point |
| `buildMapStyle` sets projection to globe | Async unit | Style-level property |
| `buildMapStyle` applies terrain exaggeration from config | Async unit | `terrain.exaggeration` matches config |

### 7.3 `searchUI.test.ts`

| Test | Type | What it verifies |
|------|------|------------------|
| `searchPlaces` parses valid geocodejson response | Async unit (mock fetch) | Correct SearchResult[] |
| `searchPlaces` returns empty array for no features | Async unit | Edge case |
| `searchPlaces` skips features without coordinates | Async unit | Robustness |
| `searchPlaces` throws on non-OK response | Async unit | Error handling |
| `searchPlaces` respects abort signal | Async unit | Cancellation |
| `isAbortError` returns true for AbortError | Pure unit | Type guard |
| `isAbortError` returns false for other errors | Pure unit | Type guard |
| `formatCoordinates` formats with 4 decimal places | Pure unit | Formatting |

### 7.4 `presetUI.test.ts`

| Test | Type | What it verifies |
|------|------|------------------|
| `PRESETS` has expected entries | Pure unit | Data integrity |
| Each preset has valid coordinates and positive zoom | Pure unit | Data validation |
| `wirePresets` calls `flyTo` with correct params on button click | DOM unit | Integration with mock map |
| `wirePresets` calls `dismissPopup` before fly-to | DOM unit | Popup cleanup |
| `wirePresets` updates status pill text | DOM unit | UI feedback |
| `wirePresets` no-ops when map is null | DOM unit | Null guard |

### 7.5 `appShell.test.ts`

| Test | Type | What it verifies |
|------|------|------------------|
| `renderAppShell` creates all expected elements | DOM unit | Element presence |
| `renderAppShell` renders correct number of preset buttons | DOM unit | Dynamic content |
| `wireDockToggle` toggles collapsed state on click | DOM unit | Interactive behavior |
| `wireDockToggle` updates aria-expanded attribute | DOM unit | Accessibility |

### 7.6 `sceneSync.test.ts`

| Test | Type | What it verifies |
|------|------|------------------|
| `syncViewState` calls terrain update when terrain enabled | Unit (mock map) | Orchestration |
| `syncViewState` calls projection update | Unit (mock map) | Orchestration |
| `updateTerrainModel` no-ops when terrain disabled | Unit | Guard clause |
| `updateTerrainModel` no-ops when exaggeration change < 0.01 | Unit | Threshold |
| `updateTerrainModel` calls setTerrain with new exaggeration | Unit (mock map) | State mutation |
| `updateProjectionMode` switches to mercator at zoom 6 | Unit (mock map) | Threshold |
| `updateProjectionMode` returns to globe at zoom 5 | Unit (mock map) | Threshold |
| `updateProjectionMode` triggers overlay sync on change | Unit | Side effect |
| `updateDetailProfile` enables performance mode at stress zoom | Unit (mock map) | Threshold |
| `updateDetailProfile` hides dense symbol layers | Unit (mock map) | Layer visibility |
| `updateDetailProfile` dismisses popup in performance mode | Unit | Popup cleanup |
| `spinGlobe` no-ops when spin disabled | Unit | Guard clause |
| `spinGlobe` no-ops when user interacting | Unit | Guard clause |
| `spinGlobe` no-ops when zoom above MAX_SPIN_ZOOM | Unit | Guard clause |
| `spinGlobe` calls easeTo with correct direction | Unit (mock map) | Animation |
| `renderSceneOverlayPresentation` shows night note on globe | DOM unit | Presentation |
| `renderSceneOverlayPresentation` hides note when empty | DOM unit | Presentation |
| `setLayerVisibility` no-ops when layer doesn't exist | Unit (mock map) | Robustness |
| `setReliefVisibility` toggles all relief layer IDs | Unit (mock map) | Layer set |

---

## 8. Estimated Sizes

| Module | Estimated lines | Functions |
|--------|----------------|-----------|
| `appShell.ts` | ~140 | `renderAppShell`, `wireDockToggle` |
| `mapStyle.ts` | ~310 | `buildMapStyle`, `selectFillOpacity`, `selectRoadOpacity`, constants, types |
| `searchUI.ts` | ~140 | `wireSearch`, `renderSearchResults`, `searchPlaces`, `isAbortError`, `formatCoordinates` |
| `presetUI.ts` | ~90 | `wirePresets`, `PRESETS`, `Preset` type |
| `metricUI.ts` | ~90 | `syncMetrics`, `calculateApproxAltitude`, `getTerrainHeight`, `classifyView`, `formatDistance`, `formatElevation` |
| `sceneSync.ts` | ~200 | `syncViewState`, `updateTerrainModel`, `updateProjectionMode`, `updateDetailProfile`, `setReliefVisibility`, `updateSatelliteOpacity`, `setLayerVisibility`, `spinGlobe`, `syncSceneOverlays`, `renderSceneOverlayPresentation`, `currentTerrainOptions` |
| `main.ts` (remaining) | ~130 | `bootstrap`, `createMap`, `wireMap`, `wireToggles` |
| **Total** | **~1,100** | (vs current 1,449 — reduction from removing duplication, explicit interfaces) |

The line count decreases because explicit interfaces replace implicit closure coupling, which often means less defensive null-checking code and fewer intermediate variables.

---

## 9. Open Questions for Review

1. **Should `MapState` move to its own file?** Currently it's a type + initial value defined in main.ts. If `sceneSync.ts` writes to it and `metricUI.ts` reads it, having the type definition in a shared file (e.g., `mapState.ts`) prevents circular dependencies. The instance stays in main.ts.

2. **Should `wireMap` be extracted?** It's ~100 lines and the most "integration-heavy" function. Arguments for keeping it in main: it references `mapState`, `statusPill`, `activePopup`, `syncViewState`, `spinGlobe`, `FEATURE_QUERY_LAYERS`, `escapeHtml`, `pickString`, `prettifyLayerName`. That's a dependency surface that spans every module. Arguments for extraction: main.ts would be ~50 lines shorter.

3. **Should `wireToggles` be extracted?** Same argument as `wireMap` — it's a dispatch function that touches every module. Extracting it just creates a new file with all the same imports. Recommendation: keep in main.

4. **What about `pickString` and `prettifyLayerName`?** These are tiny utility functions used only by `wireMap`'s click handler. They could go in `escapeHtml.ts` (renamed to `stringUtils.ts`) or stay in `main.ts`. Since they're only used in one place, leaving them in main keeps things simple.

5. **Test infrastructure for DOM-dependent modules?** The project uses Vitest. Need to confirm jsdom or happy-dom is configured for DOM tests. The existing `trafficUI.test.ts` tests pure functions only, but `searchUI.test.ts` and `appShell.test.ts` will need DOM support.
