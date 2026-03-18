# HLD: Fix duplicate fetches on repeated weather radar enable calls

**Date:** 2026-03-16
**Status:** Ready for implementation
**Files:**
- `C:\language\mdgpt54\worldviewer\src\overlays\weatherRadar.ts` (production fix, line 293)
- `C:\language\mdgpt54\worldviewer\src\overlays\weatherRadar.test.ts` (existing test, lines 520-541)

## Problem

The test "does not duplicate fetches or layers on repeated enable calls for the same map" fails with:
```
expected "vi.fn()" to be called 1 times, but got 2 times
```

Two synchronous `enable(map)` calls on the same map produce two fetches instead of one.

## Root cause

The idempotency guard at the top of `enable()` is defeated by the reassertion logic.

### Committed code (buggy)

```ts
const reassertCurrentMap = enabled && currentMap === map && needsReassertion(map);

if (enabled && currentMap === map && !reassertCurrentMap) {
  return;  // idempotency short-circuit
}
```

`needsReassertion(map)` returns `true` when the source or layer is absent from the map:

```ts
const needsReassertion = (map) =>
  !map.getSource(WEATHER_RADAR_SOURCE_ID) || !map.getLayer(WEATHER_RADAR_LAYER_ID);
```

### Trace of the two synchronous enable calls

**First `enable(map)`:**
1. `enabled` is `false`, so `reassertCurrentMap = false` and the guard doesn't fire.
2. Sets `enabled = true`, `currentMap = map`, `revision = 1`.
3. `map.isStyleLoaded()` is `true`, so calls `apply()` which fires `void refresh(map, 1)`.
4. `refresh` is async -- the fetch starts but has not resolved. No source or layer has been added yet. `currentTileUrl` remains `null`.

**Second `enable(map)` (synchronous, before the first fetch resolves):**
1. `enabled = true`, `currentMap === map` is `true`.
2. `needsReassertion(map)` checks for source/layer -- neither exists yet (the first fetch hasn't completed). Returns `true`.
3. `reassertCurrentMap = true && true && true` = `true`.
4. Guard: `true && true && !true` = `false` -- **does not short-circuit**.
5. Falls through: bumps `revision` to 2, calls `apply()` again, which fires `void refresh(map, 2)` -- **second fetch**.

Both fetches resolve and each calls `addSource` and `addLayer`, duplicating the overlay infrastructure.

### Why reassertion should not apply here

The reassertion path exists for one specific scenario: when the overlay was previously active and had tiles loaded (`currentTileUrl !== null`), but the map lost its style state (e.g., style switch) and the source/layer need to be re-added from the cached tile URL. In the bug scenario, `currentTileUrl` is still `null` because no fetch has completed yet -- there is nothing to reassert.

## Proposed fix

Add `currentTileUrl !== null` to the `reassertCurrentMap` condition:

```ts
const reassertCurrentMap = enabled && currentMap === map && currentTileUrl !== null && needsReassertion(map);
```

This is a one-token change. It ensures reassertion only activates when there is actually a cached tile URL to reassert, which is the only case where bypassing the idempotency guard is correct.

### Why this is the right fix (overlay code, not test)

This is a real bug in the overlay code, not a test expectation mismatch:
- Two fetches against the RainViewer API waste bandwidth and could cause race conditions where two responses try to add the same source/layer.
- The `addSource` / `addLayer` calls from both responses hitting the map will cause MapLibre errors (duplicate source/layer IDs).
- The idempotency guard's intent is clear from the code structure -- the second enable on the same map should be a no-op.

## Risk assessment

**Risk: Low**

- The change is a single additional condition (`currentTileUrl !== null`) that narrows when reassertion fires.
- The reassertion path (tested in "reasserts the overlay on repeated enable when the same map loses style state", lines 448-518) still works correctly because in that scenario `currentTileUrl` is non-null -- the first fetch completed and set a tile URL before the external removal and second `enable` call.
- No other code paths are affected because `reassertCurrentMap` is only computed and used within `enable()`.
- The fix has already been verified locally: all 12 tests pass with the working-tree change.

**Edge case analysis:**
- Enable while style not loaded, then enable again: `enabled=true` but `map.isStyleLoaded()=false` on first call defers to load handler; second call has `enabled=true`, `currentMap===map`, `currentTileUrl===null`, `reassertCurrentMap=false`, guard fires -- correctly short-circuits. The load handler from the first enable was already cleared by `clearLoadHandler()` and replaced, but with the guard the second call returns early, leaving the first load handler intact. This is actually better behavior than the old code.
- Enable on map A, then enable on map B before fetch completes: The `currentMap !== map` branch handles this (line 299). Not affected by this change.

## Test plan

1. **Existing test passes:** "does not duplicate fetches or layers on repeated enable calls for the same map" (lines 520-541) -- this is the test that currently fails and should pass after the fix.
2. **Reassertion still works:** "reasserts the overlay on repeated enable when the same map loses style state" (lines 448-518) -- must continue to pass, confirming the `currentTileUrl !== null` condition correctly allows reassertion when tiles were previously loaded.
3. **Full suite:** All 12 weather radar tests pass (verified locally).
4. **No new tests needed:** The existing test suite already covers both the failing case and the reassertion case. The fix is a narrowing of an existing condition, not new behavior.
