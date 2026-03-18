# HLD: Test Quality Improvements

**Date:** 2026-03-16
**Priority:** Low
**Status:** Draft

---

## 1. Extract shared MockMap factory for overlay tests

### Current state

Both `src/overlays/solarTerminator.test.ts` (lines 16-70) and `src/overlays/weatherRadar.test.ts` (lines 24-83) define their own `MockMap` class. The two implementations share identical structure and nearly identical code.

### Shared surface (identical in both)

| Member | Signature | Behavior |
|---|---|---|
| `styleLoaded` | `boolean` field, initially `true` | Controls `isStyleLoaded()` return |
| `addLayer` | `vi.fn((layer, beforeId?) => ...)` | Stores in `layers` Map, records anchor |
| `getLayer` | `vi.fn((id) => ...)` | Lookups from `layers` Map |
| `removeLayer` | `vi.fn((id) => ...)` | Deletes from `layers` and `layerAnchors` |
| `removeSource` | `vi.fn((id) => ...)` | Deletes from `sources` Map |
| `isStyleLoaded` | `vi.fn(() => this.styleLoaded)` | Delegates to field |
| `on` / `off` | `vi.fn((event, listener) => ...)` | Manages `loadListeners` Set for `"load"` |
| `getStyle` | `vi.fn(() => ({ layers: [...] }))` | Returns style stub |
| `emitLoad()` | method | Sets `styleLoaded = true`, fires listeners |
| `getLayerAnchor(id)` | method | Returns stored anchor for a layer |
| Private backing | `sources`, `layers`, `layerAnchors`, `loadListeners` | Map/Set storage |

### Differences

| Aspect | solarTerminator | weatherRadar |
|---|---|---|
| `addSource` callback | Wraps source with `{ ...source, setData: vi.fn() }` | Wraps source with `{ ...source, setTiles: vi.fn((tiles) => { storedSource.tiles = tiles }) }` |
| `getSource` return type | `{ setData: ReturnType<typeof vi.fn> }` | `SourceRecord` (typed with `attribution?`, `maxzoom?`, `setTiles`, `tileSize?`, `tiles?`, `type?`) |
| `getStyle` default layers | `[satellite-imagery, label_city]` | `[background, satellite-imagery, road_minor, label_city]` |

The only structural difference is in `addSource`: what extra method gets patched onto the stored source record (`setData` vs `setTiles`). Everything else is copy-paste identical.

### Proposed design

Create a shared factory at `src/overlays/test/createMockMap.ts`:

```
createMockMap(options?: {
  defaultStyleLayers?: Array<{ id: string; type: string; source?: string; layout?: unknown }>;
  sourceFactory?: (id: string, source: Record<string, unknown>) => Record<string, unknown>;
}): MockMap
```

- `sourceFactory` lets each test file inject the source-specific mock behavior (`setData` for solar, `setTiles` for weather). If omitted, sources are stored as-is.
- `defaultStyleLayers` lets each test customize the `getStyle()` return. If omitted, use a sensible default that covers both current cases (the weatherRadar 4-layer set is a superset).
- The return type `MockMap` exposes the public interface (all `vi.fn` members plus `emitLoad()` and `getLayerAnchor()`).
- Both test files replace their inline `MockMap` class with a `createMockMap(...)` call configured for their source type.

### File plan

| File | Action |
|---|---|
| `src/overlays/test/createMockMap.ts` | **Create** - shared factory |
| `src/overlays/solarTerminator.test.ts` | **Modify** - remove inline MockMap, import factory, configure with `setData` source |
| `src/overlays/weatherRadar.test.ts` | **Modify** - remove inline MockMap (and `SourceRecord` type), import factory, configure with `setTiles` source |

---

## 2. Add tests for aircraftIconSizing.ts

### Current state

`src/traffic/aircraftIconSizing.ts` exports:
- `AIRCRAFT_ICON_SIZE` = 48 (constant)
- `AIRCRAFT_ICON_PIXEL_RATIO` = 2 (constant)
- `AIRCRAFT_ICON_MAX_SCALE` = 0.58 (constant)
- `AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX` = 48 / 2 * 0.58 = 13.92 (derived constant)
- `aircraftIconSizeExpression()` - returns a Mapbox GL `interpolate` expression with 3 zoom stops: `[5, 0.42]`, `[8, 0.48]`, `[12, 0.58]`

The constants (`AIRCRAFT_ICON_SIZE`, `AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX`) are consumed by `trafficLayers.ts` (icon canvas sizing) and `aircraft3d.ts` (handoff threshold). The expression is used in `trafficLayers.ts` as the `icon-size` layout property. The 3D handoff tests in `aircraft3d.test.ts` and `aircraft3dLayer.test.ts` exercise `AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX` transitively but never directly verify the zoom interpolation stops or the constant derivation.

### What to test

**A. Constant derivation (sanity guard)**

Verify that `AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX` equals `(AIRCRAFT_ICON_SIZE / AIRCRAFT_ICON_PIXEL_RATIO) * AIRCRAFT_ICON_MAX_SCALE`. This catches silent breakage if someone changes a constant without updating dependents.

**B. Zoom interpolation expression structure**

Verify `aircraftIconSizeExpression()` returns the expected tuple. This is a structural assertion (the expression is declarative data, not computed logic), so a single snapshot-style equality check is appropriate.

**C. Zoom interpolation monotonicity and boundary values**

Evaluate the linear interpolation at the declared stops and between them to confirm the scale ramps correctly. This is the part that currently has no direct coverage.

Proposed test cases:

| Test case | Input zoom | Expected scale | Notes |
|---|---|---|---|
| Below min stop | zoom < 5 | 0.42 (clamped) | Mapbox GL clamps below first stop |
| At min stop | zoom = 5 | 0.42 | Exact stop |
| Mid-range (low) | zoom = 6.5 | lerp(0.42, 0.48, (6.5-5)/(8-5)) = 0.45 | Linear interpolation |
| At mid stop | zoom = 8 | 0.48 | Exact stop |
| Mid-range (high) | zoom = 10 | lerp(0.48, 0.58, (10-8)/(12-8)) = 0.53 | Linear interpolation |
| At max stop | zoom = 12 | 0.58 | Exact stop |
| Above max stop | zoom > 12 | 0.58 (clamped) | Mapbox GL clamps above last stop |

Since `aircraftIconSizeExpression()` returns a Mapbox GL expression (not executable JS), we can't call it directly to get a number. Two options:

1. **Structural assertion only** - assert the returned tuple matches the expected literal. Simple, clear, and sufficient since the expression is declarative. The linear interpolation behavior is Mapbox GL's responsibility, not ours.
2. **Write a tiny `evaluateLinearInterpolation()` helper** in the test file that interprets the `["interpolate", ["linear"], ["zoom"], ...stops]` tuple and evaluates it for a given zoom level. This lets us write the boundary/mid-range assertions above.

**Recommendation:** Do both. The structural assertion is the primary guard. The interpolation evaluation is a supplementary oracle that verifies the stops produce the expected ramp, at negligible cost. The `evaluateLinearInterpolation` helper is ~15 lines and reusable if we add more interpolation expressions later.

### Proposed test file

| File | Action |
|---|---|
| `src/traffic/aircraftIconSizing.test.ts` | **Create** - new test file |

Test structure:

```
describe("aircraftIconSizing", () => {
  it("derives the max 2D symbol pixel size from base constants")
  it("returns the expected zoom interpolation expression")
  it("ramps scale linearly between declared zoom stops")
})
```

---

## 3. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| MockMap factory over-abstracts, making individual tests harder to read | Low | Keep the factory API minimal (2 optional params). Each call site should remain a single line. If a test needs unusual behavior, it can still override individual `vi.fn` members after creation. |
| MockMap extraction introduces a cross-file import that slows test iteration | Negligible | The shared file is tiny and has no runtime dependencies. |
| `aircraftIconSizing` tests are low-value because the expression is declarative data | Low | The structural assertion guards against accidental edits. The interpolation evaluation is cheap insurance. Both tests are ~30 lines total. |
| `evaluateLinearInterpolation` helper diverges from Mapbox GL's actual interpolation | Low | The helper only needs to handle `["interpolate", ["linear"], ["zoom"], ...stops]` - a single well-documented formula. We can validate it against known Mapbox GL behavior in the test itself. |
| Shared `test/` directory creates a new convention | Low | The `src/overlays/test/` directory is scoped to overlay tests. If more shared test utilities emerge elsewhere, they can follow the same pattern (`src/<domain>/test/`). |

---

## 4. File location summary

### Existing files to read/modify

- `C:\language\mdgpt54\worldviewer\src\overlays\solarTerminator.test.ts` - remove inline MockMap
- `C:\language\mdgpt54\worldviewer\src\overlays\weatherRadar.test.ts` - remove inline MockMap and SourceRecord
- `C:\language\mdgpt54\worldviewer\src\traffic\aircraftIconSizing.ts` - module under test (no changes)

### New files to create

- `C:\language\mdgpt54\worldviewer\src\overlays\test\createMockMap.ts` - shared MockMap factory
- `C:\language\mdgpt54\worldviewer\src\traffic\aircraftIconSizing.test.ts` - new test file
