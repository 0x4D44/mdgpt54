# Worldviewer Feature Brainstorm

Generated 2026-03-16. Grounded in the current codebase: MapLibre GL 5.20, Three.js 0.183, Vite 7, TypeScript strict, vitest. Each idea is assessed relative to the existing architecture (globe projection, live traffic, overlay system, control dock UI).

---

## 1. Flight Trail Ribbons

**Description:** When an aircraft is selected (clicked), draw a fading polyline trail behind it showing its recent trajectory. Store the last N position updates per track in a ring buffer and render them as a GeoJSON LineString with decreasing opacity. At close zoom with 3D enabled, extrude the trail as a Three.js ribbon at true altitude.

**Complexity:** Medium

**Key considerations:**
- The `LiveTrack` type only carries the latest position; you need a client-side history accumulator keyed by `track.id` that grows on each snapshot.
- Ring buffer size caps memory (e.g., 60 positions x 200 aircraft = 12K points, negligible).
- The 2D GeoJSON path is straightforward (add a `line` layer sourced from accumulated points). The 3D ribbon is harder -- it requires a custom `BufferGeometry` updated each frame inside `Aircraft3dRuntimeLayer`.
- Stale track eviction must also evict history to prevent leaks.

---

## 2. Time-of-Day Atmosphere

**Description:** Replace the static dark space backdrop with a physically-motivated atmosphere gradient that shifts based on the subsolar point. At orbit zoom, the sunlit limb glows warm amber while the dark limb deepens to navy. The existing `solarTerminator` module already computes the subsolar point -- this would consume the same data to drive CSS gradients or a canvas-based sky dome behind the map.

**Complexity:** Small-Medium

**Key considerations:**
- MapLibre's `sky` property supports atmosphere coloring in globe mode. The current style already has a `sky` slot (unused). Setting `sky.atmosphere-color` and `sky.space-color` dynamically based on `getSubsolarPoint(new Date())` could deliver 80% of the effect with three lines.
- Fallback: a full-viewport `<canvas>` behind the map panel with a radial gradient anchored to the projected subsolar screen position.
- Must fade out gracefully when switching from globe to mercator at zoom 6 (mirroring the night overlay behavior in `projectionBehavior.ts`).

---

## 3. Aircraft Encounter Detector

**Description:** Scan the current aircraft snapshot for pairs of tracks whose 3D separation (horizontal + vertical) falls below configurable thresholds and highlight them with a pulsing ring or connecting line. This turns the viewer into a lightweight airspace awareness tool and surfaces interesting near-misses in busy terminal areas.

**Complexity:** Medium

**Key considerations:**
- Pairwise distance for N aircraft is O(N^2), but N is capped at a few hundred in a viewport, so brute force is fine.
- Horizontal distance via haversine; vertical from `altitudeMeters`/`geoAltitudeMeters`. Define thresholds like <5 NM horizontal + <1000 ft vertical.
- Render as a separate GeoJSON `line` layer connecting the pair centers, with a `circle` pulse at each endpoint.
- Must tolerate missing altitude data gracefully (skip those tracks).

---

## 4. Shareable Camera Links

**Description:** Encode the current camera state (center, zoom, pitch, bearing) plus active overlay toggles into a URL fragment or query string. Opening the link restores the exact view. This makes it trivial to share "look at this view of the Alps" or "check out aircraft over Heathrow."

**Complexity:** Small

**Key considerations:**
- Read/write `window.location.hash` on moveend with a debounce (already have `debounce` in `trafficHelpers.ts`).
- Format: `#lat,lng,z,p,b,flags` where flags is a bitfield for terrain/relief/night/weather/buildings/spin/aircraft/ships.
- On load, parse the hash before `bootstrap()` and override the default center/zoom/pitch/bearing and `mapState` toggles.
- Must handle partial or malformed hashes gracefully (fall back to defaults).
- No server component needed.

---

## 5. Elevation Profile on Click-Drag

**Description:** Let the user shift-drag a line across the map surface, then render a compact elevation cross-section chart in the control dock. Query terrain elevation at sampled points along the line using `map.queryTerrainElevation()`. The chart updates live as the user drags.

**Complexity:** Medium

**Key considerations:**
- `queryTerrainElevation` returns exaggerated height; must normalize via `normalizeTerrainElevation()` from `reliefProfile.ts`.
- Sample 100-200 points along the great-circle path; render as a simple `<canvas>` sparkline or SVG polyline inside the metric section.
- Interaction: intercept shift+mousedown on the map canvas, draw a temporary GeoJSON line, sample on mousemove, finalize on mouseup.
- Works only when terrain is enabled; show a hint otherwise.
- The existing `calculateApproxAltitude` logic gives camera altitude -- this feature gives ground altitude, a nice complement.

---

## 6. ISS Live Tracker

**Description:** Fetch the International Space Station's real-time position from the public `api.wheretheiss.at` endpoint (no key required) and render it as a special icon on the globe. At orbit zoom, the ISS appears at its true orbital position; the viewer already operates at this scale naturally. Optionally draw the ground track as a dashed great-circle line.

**Complexity:** Small

**Key considerations:**
- Single HTTP poll every 5 seconds to `https://api.wheretheiss.at/v1/satellites/25544`.
- Returns `{ latitude, longitude, altitude, velocity }` -- map to a `LiveTrack`-like object on a dedicated GeoJSON source (not mixed into traffic).
- Orbital altitude (~408 km) is way above aircraft; useful as a fun reference point.
- Render as a custom icon (small satellite silhouette) with a label. Add a toggle chip in the Scene section.
- Ground track: precompute the next-orbit path from TLE data (heavier) or just accumulate past positions (simpler).

---

## 7. Heatmap Layer for Traffic Density

**Description:** Add a heatmap visualization mode that shows aircraft or ship density as a color field instead of individual icons. Toggle between point mode (current) and heatmap mode. Useful at mid-zoom where hundreds of individual icons become cluttered but the density pattern is informative.

**Complexity:** Small-Medium

**Key considerations:**
- MapLibre natively supports `heatmap` layer type. Swap or overlay it on the existing `live-aircraft` GeoJSON source.
- Weight by speed or altitude for aircraft; by speed for ships.
- Tuning the `heatmap-radius` and `heatmap-intensity` zoom interpolation is the main design work.
- Add a "Heatmap" toggle chip or make it a third state on the existing aircraft/ships toggles.
- The existing clustering already handles visual declutter; heatmap is the continuous-field alternative.

---

## 8. Cinematic Orbit Mode

**Description:** A "screensaver" mode that continuously flies between preset locations with smooth camera paths, dwelling at each for 15-20 seconds before transitioning to the next. The camera follows bezier-interpolated arcs that pass through orbit altitude between cities, giving the full orbit-to-street-to-orbit experience hands-free.

**Complexity:** Medium

**Key considerations:**
- The preset infrastructure (`PRESETS` array, `flyTo` calls) already exists. This chains them with `map.once("moveend")` callbacks.
- Camera path: `flyTo` with `speed: 0.4` and high `curve` gives cinematic arcs automatically.
- Shuffle or cycle through presets. Pause on any user interaction; resume after idle timeout.
- Could include the search result history as additional waypoints.
- Nice for kiosk/demo deployments.

---

## 9. Offline Tile Cache (Service Worker)

**Description:** Register a service worker that caches recently-viewed map tiles (satellite imagery, vector tiles, terrain DEM) so the viewer works partially offline or on flaky connections. Implement a cache-first strategy with background revalidation for tile requests matching known tile URL patterns.

**Complexity:** Medium-Large

**Key considerations:**
- Vite supports service worker generation via `vite-plugin-pwa` or manual registration.
- Cache strategy: intercept fetch requests matching `tiles.openfreemap.org`, `tiles.maps.eox.at`, `elevation-tiles-prod.s3.amazonaws.com`. Use Cache API with size limits (e.g., 500 MB).
- Must handle cache eviction (LRU by tile access time).
- Live traffic (OpenSky, AISStream WebSocket) cannot be cached; only static tile layers benefit.
- Progressive enhancement: app works identically when online, degrades gracefully offline.

---

## 10. Coordinate Readout and Copy

**Description:** Show the cursor's geographic coordinates (lat/lng) and terrain elevation in a compact readout anchored to the bottom of the viewport, updating on mousemove. Click to copy coordinates to clipboard in a configurable format (decimal degrees, DMS, UTM).

**Complexity:** Small

**Key considerations:**
- `map.on("mousemove", (e) => e.lngLat)` gives coordinates. `map.queryTerrainElevation(e.lngLat)` gives height.
- Render in a new element near the status pill or as a hover tooltip.
- Throttle updates to ~10 Hz to avoid DOM thrash.
- Format toggle: store preference in localStorage.
- On touch devices, use long-press instead of hover.

---

## 11. Wind and Pressure Overlay

**Description:** Overlay animated wind particle flow on the globe using data from a public weather model (e.g., Open-Meteo or GFS). Particles drift across the map surface following wind vectors, creating a hypnotic flow visualization similar to earth.nullschool.net. Pressure isobars rendered as contour lines.

**Complexity:** Large

**Key considerations:**
- Wind data: Open-Meteo API provides free global wind grids at ~0.25-degree resolution. Fetch a single timestep as JSON.
- Particle animation: render as a WebGL custom layer (like `Aircraft3dRuntimeLayer`) with a particle shader that advects thousands of points along the wind field each frame.
- Alternatively, use a pre-rendered tile set from a service like Windy (but that introduces a dependency).
- This is the single most visually impressive possible addition but also the hardest to get right. The shader math for bilinear wind interpolation and particle recycling is non-trivial.
- Good candidate for a standalone module with its own enable/disable lifecycle matching the overlay pattern.

---

## 12. Ship Wake and Heading Indicator

**Description:** Enhance ship rendering with a tapered wake trail behind each vessel (proportional to speed) and a heading cone showing the vessel's bearing. Ships currently render as a simple `>` text symbol -- this replaces it with a proper maritime icon set, similar to how aircraft already have category-specific silhouettes.

**Complexity:** Small-Medium

**Key considerations:**
- Generate ship icon images on canvas (like `createAircraftIcon`) with hull shapes varying by vessel type (if AISStream provides ship type).
- Wake: a short polyline or triangle behind each ship, scaled by `speedKnots`. Add as feature properties and render with a `line` layer using `line-gradient`.
- Heading cone: a semi-transparent triangle in front of the ship icon extending in the heading direction.
- The ship `>` symbol currently uses `text-rotate` for heading; icons would use `icon-rotate` instead, matching the aircraft pattern.

---

## 13. Split-Screen Time Comparison

**Description:** Split the viewport into two synchronized map panels showing the same location at two different times -- e.g., current Sentinel-2 imagery vs. a historical image from a different year. Both panels stay locked in zoom/pitch/bearing. Useful for observing urban growth, deforestation, or seasonal changes.

**Complexity:** Medium-Large

**Key considerations:**
- MapLibre supports multiple map instances. Create a second `Map` on a side-by-side `<div>` with synced camera via `syncMove` event listeners.
- Historical imagery: EOX provides multiple Sentinel-2 yearly composites (2018-2024) at the same tile endpoint pattern.
- UI: a slider divider between the two panels (CSS resize or drag handle).
- Memory/GPU cost doubles. Must disable terrain on the comparison panel or accept the cost.
- Could also compare day satellite vs. night lights (VIIRS) for a dramatic visual contrast.

---

## 14. Airport and Runway Annotations

**Description:** When zoomed to an airport area, overlay runway diagrams, IATA/ICAO codes, and basic airport metadata (elevation, runway lengths) sourced from a static dataset. Detect nearby aircraft on approach/departure and annotate their probable runway assignment.

**Complexity:** Medium

**Key considerations:**
- Airport data: OurAirports CSV (public domain) has ~70K airports with coordinates, elevation, runway data. Process into a static JSON shard set similar to the aircraft identity store.
- Display as a symbol layer with custom icons at zoom 10-16. Runways as short line features at zoom 13+.
- Runway assignment inference: compare aircraft heading and position relative to runway heading/threshold. This is approximate but visually compelling.
- Data size: the full OurAirports dataset is ~15 MB; shard by geographic region and lazy-load like `AircraftIdentityStore`.

---

## 15. Minimap Globe Inset

**Description:** Render a small fixed globe in the corner of the viewport (like a radar minimap in a game) that shows the user's current viewport position as a highlighted rectangle on Earth. When zoomed in at street level, this provides geographic context that is otherwise lost. Click the minimap to jump to a location.

**Complexity:** Small-Medium

**Key considerations:**
- Create a second MapLibre `Map` instance in a small `<div>` (200x200px) locked to globe projection, low zoom, no terrain.
- On the main map's `move` event, update a GeoJSON rectangle source on the minimap showing the main viewport bounds.
- Lightweight: the minimap uses the same vector tile source (already cached) at low zoom with minimal layers.
- Hide the minimap when the main map is already at orbit zoom (zoom < 5) since it would be redundant.
- Click handler: `minimap.on("click", (e) => mainMap.flyTo({ center: e.lngLat }))`.

---

## 16. Measurement Tool

**Description:** A mode where the user clicks points on the map to measure great-circle distance (point-to-point and cumulative path), area (closed polygon), and bearing between points. Display results in metric and imperial with the great-circle path rendered as a geodesic line.

**Complexity:** Medium

**Key considerations:**
- Interaction state machine: click adds waypoints, double-click closes, Escape cancels.
- Great-circle distance: Vincenty or haversine formula. The existing `EARTH_CIRCUMFERENCE_METERS` constant in `aircraft3d.ts` is a starting point.
- Render waypoints as circle markers, path as a GeoJSON LineString on a dedicated source/layer.
- Area computation: spherical excess formula for polygons on a sphere.
- Add a "Measure" toggle chip in the Scene section that activates/deactivates the mode.

---

## 17. Natural Disaster Alert Overlay

**Description:** Pull recent earthquake, volcano, and severe weather alerts from public APIs (USGS Earthquake API, GDACS) and plot them on the globe as pulsing markers with magnitude/severity coloring. Clicking an event shows a popup with details, timestamp, and a link to the source. This leverages the globe view to show global event patterns.

**Complexity:** Small-Medium

**Key considerations:**
- USGS: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` returns a GeoJSON FeatureCollection directly -- add as a source with no transformation.
- GDACS: RSS/JSON feed for volcanic eruptions and tropical cyclones.
- Render earthquakes as circles sized by magnitude with a pulse animation (MapLibre `circle-radius` with an `animate` driver or CSS animation on a marker).
- Refresh every 5 minutes. Add an "Alerts" toggle chip.
- The globe view at orbit zoom is perfect for showing the Ring of Fire pattern.

---

## 18. Photo Overlay (Geotagged Images)

**Description:** Integrate with Wikimedia Commons or Mapillary to show geotagged photos as thumbnail markers at street zoom. Clicking a marker opens the full image in a lightbox overlay. This adds a human-scale layer to complement the satellite/terrain/traffic data.

**Complexity:** Medium

**Key considerations:**
- Wikimedia Commons API: query geotagged images within the viewport bbox. Rate-limited but free.
- Mapillary: requires API key but provides street-level coverage.
- Display as clustered symbol layer with thumbnail images loaded as map icons (MapLibre `addImage` from fetched thumbnails).
- Must manage image loading lifecycle carefully -- cancel fetches on pan, cache loaded thumbnails, limit concurrent requests.
- Only active at zoom 14+ to avoid flooding the map with markers at wider scales.
- Lightbox: a simple modal `<div>` overlay, no library needed.

---

## 19. Route Playback for Aircraft

**Description:** When an aircraft is selected, fetch its recent flight path from a public history API (e.g., OpenSky historical data or adsbexchange) and animate the aircraft icon retracing its route from takeoff to current position. The camera optionally follows the aircraft in a chase-cam mode.

**Complexity:** Large

**Key considerations:**
- OpenSky's track API (`/tracks/all?icao24=...&time=0`) returns waypoints for the last flight of a given aircraft. Free but rate-limited.
- Animation: interpolate between waypoints at accelerated time, updating the aircraft's GeoJSON feature position each frame.
- Chase-cam: use `map.easeTo` to keep the aircraft centered with a trailing bearing offset.
- The 3D layer could show the aircraft model flying along the path at true altitude -- visually stunning but requires tight coordination between the 2D/3D rendering paths.
- Fallback: if no history API is available, just animate the accumulated client-side trail (feature 1) in reverse.

---

## 20. Dark Sky / Light Pollution Map

**Description:** Overlay a light pollution / dark sky quality layer showing areas of the world where stars are most visible. Use the World Atlas of Artificial Night Sky Brightness (Falchi et al.) raster tiles. When combined with the night overlay, this shows which parts of the dark hemisphere actually have dark skies vs. urban light domes.

**Complexity:** Small

**Key considerations:**
- The light pollution data is available as pre-rendered raster tiles from `https://djlorenz.github.io/astronomy/lp2022/` and similar sources.
- Implementation mirrors the weather radar overlay pattern exactly: raster tile source + raster layer with opacity control.
- Most impactful at orbit zoom with the night overlay active -- the synergy between these features is strong.
- Add as a toggle chip or combine with the Night toggle as a sub-option.
- Tile availability and hosting reliability of third-party sources is the main risk.

---

## Priority Sketch

| Tier | Features | Rationale |
|------|----------|-----------|
| Quick wins | 4 (Shareable Links), 10 (Coordinate Readout), 7 (Heatmap) | Small effort, immediate user value, no new dependencies |
| High impact | 2 (Atmosphere), 8 (Cinematic Orbit), 6 (ISS Tracker), 17 (Disaster Alerts) | Lean into the globe identity; mostly API consumption + existing overlay pattern |
| Depth features | 1 (Flight Trails), 12 (Ship Icons), 14 (Airport Annotations), 16 (Measurement) | Enrich the traffic and exploration experience |
| Ambitious | 11 (Wind Overlay), 13 (Split-Screen), 19 (Route Playback), 5 (Elevation Profile) | High visual payoff but significant engineering |
| Infrastructure | 9 (Offline Cache), 15 (Minimap) | Platform improvements, less flashy |
