import { afterEach, describe, expect, it, vi } from "vitest";
import type { Map } from "maplibre-gl";

import { TOGGLES, dispatchToggle, type ToggleEffectDeps } from "./sceneToggles";
import { BUILDING_LAYER_ID, FLAT_BUILDING_LAYER_ID } from "./mapStyle";
import {
  BOOLEAN_KEYS,
  KEY_ORDER,
  parseHash,
  serializeHash,
  type CameraHashState
} from "./cameraHash";
import type { MapState } from "./mapState";
import type { SceneSyncDeps } from "./sceneSync";

// Mock the scene-sync side-effect helpers so toggle effects can be asserted
// without a real MapLibre map.
vi.mock("./sceneSync", () => ({
  syncViewState: vi.fn(),
  syncSceneOverlays: vi.fn(),
  setReliefVisibility: vi.fn(),
  setLayerVisibility: vi.fn(),
  spinGlobe: vi.fn(),
  currentTerrainOptions: vi.fn(() => ({ source: "terrain-mesh", exaggeration: 1.2 }))
}));

import {
  syncViewState,
  syncSceneOverlays,
  setReliefVisibility,
  setLayerVisibility,
  spinGlobe,
  currentTerrainOptions
} from "./sceneSync";

const TOGGLE_NAMES = [
  "terrain",
  "relief",
  "night",
  "weather",
  "earthquakes",
  "iss",
  "buildings",
  "spin",
  "measure"
] as const;

/** Every boolean MapState field a toggle may flip, with default values. */
function createFakeMapState(): MapState {
  return {
    terrainEnabled: true,
    buildingsEnabled: true,
    reliefEnabled: true,
    nightEnabled: true,
    weatherEnabled: false,
    earthquakeEnabled: false,
    issEnabled: false,
    measureEnabled: false,
    autoSpinEnabled: true,
    userInteracting: false,
    stressModeActive: false,
    terrainExaggeration: 1.2,
    projectionMode: "globe"
  };
}

function createDeps(mapState: MapState = createFakeMapState()): {
  deps: ToggleEffectDeps;
  setTerrain: ReturnType<typeof vi.fn>;
  syncTimeScrubberVisibility: ReturnType<typeof vi.fn>;
} {
  const setTerrain = vi.fn();
  const fakeMap = { setTerrain } as unknown as Map;
  const syncTimeScrubberVisibility = vi.fn();
  const deps: ToggleEffectDeps = {
    map: fakeMap,
    mapState,
    sceneSyncDeps: {} as SceneSyncDeps,
    syncTimeScrubberVisibility
  };
  return { deps, setTerrain, syncTimeScrubberVisibility };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("sceneToggles", () => {
  describe("table integrity", () => {
    it("encodes exactly the 9 known data-toggle names", () => {
      expect(TOGGLES.map((t) => t.name)).toEqual([...TOGGLE_NAMES]);
    });

    it("has unique names", () => {
      const names = TOGGLES.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("has unique stateKeys", () => {
      const keys = TOGGLES.map((t) => t.stateKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("defines hashKeys whose set deep-equals cameraHash BOOLEAN_KEYS", () => {
      const hashKeys = new Set(
        TOGGLES.map((t) => t.hashKey).filter((k): k is NonNullable<typeof k> => k !== undefined)
      );
      expect(hashKeys).toEqual(BOOLEAN_KEYS);
    });

    it("only persists the six expected toggles in the hash", () => {
      const persisted = TOGGLES.filter((t) => t.hashKey).map((t) => t.name).sort();
      expect(persisted).toEqual(["buildings", "night", "relief", "spin", "terrain", "weather"]);
    });

    it("keeps the runtime-only toggles out of the hash", () => {
      for (const name of ["earthquakes", "iss", "measure"]) {
        const def = TOGGLES.find((t) => t.name === name)!;
        expect(def.hashKey).toBeUndefined();
      }
    });

    it("places every hashKey in cameraHash KEY_ORDER", () => {
      for (const def of TOGGLES) {
        if (!def.hashKey) continue;
        expect(KEY_ORDER).toContain(def.hashKey);
      }
    });
  });

  describe("dispatchToggle state mutation", () => {
    it("flips each mapState boolean true -> false", () => {
      const mapState = createFakeMapState();
      // Force every toggle's stateKey to true so a single dispatch flips it to false.
      for (const def of TOGGLES) {
        mapState[def.stateKey] = true;
      }

      const { deps } = createDeps(mapState);
      for (const def of TOGGLES) {
        const result = dispatchToggle(def.name, deps);
        expect(result).not.toBeNull();
        expect(result!.on).toBe(false);
        expect(mapState[def.stateKey]).toBe(false);
      }
    });

    it("returns null and mutates nothing for an unknown name", () => {
      const mapState = createFakeMapState();
      const before = { ...mapState };
      const { deps } = createDeps(mapState);
      expect(dispatchToggle("does-not-exist", deps)).toBeNull();
      expect(mapState).toEqual(before);
    });
  });

  describe("status strings", () => {
    it("returns result.status === def.status(result.on)", () => {
      const mapState = createFakeMapState();
      const { deps } = createDeps(mapState);
      for (const def of TOGGLES) {
        const result = dispatchToggle(def.name, deps)!;
        expect(result.status).toBe(def.status(result.on));
      }
    });

    it("has non-empty and distinct on/off strings", () => {
      for (const def of TOGGLES) {
        const onStr = def.status(true);
        const offStr = def.status(false);
        expect(onStr.length).toBeGreaterThan(0);
        expect(offStr.length).toBeGreaterThan(0);
        expect(onStr).not.toBe(offStr);
      }
    });
  });

  describe("effects", () => {
    it("terrain: setTerrain(opts) + syncViewState when enabling", () => {
      const mapState = createFakeMapState();
      mapState.terrainEnabled = false; // dispatch flips to true
      const { deps, setTerrain } = createDeps(mapState);

      dispatchToggle("terrain", deps);

      expect(currentTerrainOptions).toHaveBeenCalledTimes(1);
      expect(setTerrain).toHaveBeenCalledWith({ source: "terrain-mesh", exaggeration: 1.2 });
      expect(syncViewState).toHaveBeenCalledTimes(1);
    });

    it("terrain: setTerrain(null) when disabling", () => {
      const mapState = createFakeMapState();
      mapState.terrainEnabled = true; // dispatch flips to false
      const { deps, setTerrain } = createDeps(mapState);

      dispatchToggle("terrain", deps);

      expect(setTerrain).toHaveBeenCalledWith(null);
      expect(currentTerrainOptions).not.toHaveBeenCalled();
      expect(syncViewState).toHaveBeenCalledTimes(1);
    });

    it("relief: setReliefVisibility", () => {
      const mapState = createFakeMapState();
      const { deps } = createDeps(mapState);
      dispatchToggle("relief", deps);
      expect(setReliefVisibility).toHaveBeenCalledTimes(1);
    });

    it("buildings: two setLayerVisibility + syncViewState", () => {
      const mapState = createFakeMapState();
      mapState.buildingsEnabled = false; // flips to true
      const { deps } = createDeps(mapState);
      dispatchToggle("buildings", deps);
      expect(setLayerVisibility).toHaveBeenCalledTimes(2);
      expect(setLayerVisibility).toHaveBeenNthCalledWith(1, deps.map, BUILDING_LAYER_ID, true);
      expect(setLayerVisibility).toHaveBeenNthCalledWith(2, deps.map, FLAT_BUILDING_LAYER_ID, true);
      expect(syncViewState).toHaveBeenCalledTimes(1);
    });

    it("night: syncSceneOverlays + syncTimeScrubberVisibility", () => {
      const mapState = createFakeMapState();
      const { deps, syncTimeScrubberVisibility } = createDeps(mapState);
      dispatchToggle("night", deps);
      expect(syncSceneOverlays).toHaveBeenCalledTimes(1);
      expect(syncTimeScrubberVisibility).toHaveBeenCalledTimes(1);
    });

    it.each(["weather", "earthquakes", "iss", "measure"])(
      "%s: syncSceneOverlays only",
      (name) => {
        const mapState = createFakeMapState();
        const { deps, syncTimeScrubberVisibility } = createDeps(mapState);
        dispatchToggle(name, deps);
        expect(syncSceneOverlays).toHaveBeenCalledTimes(1);
        expect(syncTimeScrubberVisibility).not.toHaveBeenCalled();
        expect(syncViewState).not.toHaveBeenCalled();
        expect(setReliefVisibility).not.toHaveBeenCalled();
        expect(setLayerVisibility).not.toHaveBeenCalled();
        expect(spinGlobe).not.toHaveBeenCalled();
      }
    );

    it("spin: spinGlobe only when turning on", () => {
      const mapState = createFakeMapState();
      mapState.autoSpinEnabled = false; // flips to true
      const { deps } = createDeps(mapState);
      dispatchToggle("spin", deps);
      expect(spinGlobe).toHaveBeenCalledTimes(1);
    });

    it("spin: no spinGlobe when turning off", () => {
      const mapState = createFakeMapState();
      mapState.autoSpinEnabled = true; // flips to false
      const { deps } = createDeps(mapState);
      dispatchToggle("spin", deps);
      expect(spinGlobe).not.toHaveBeenCalled();
    });
  });

  describe("hash round-trip oracle", () => {
    const HASH_DEFS = TOGGLES.filter((t) => t.hashKey);

    it("survives all 2^6 combinations through serialize/parse + the table loop", () => {
      const count = HASH_DEFS.length;
      expect(count).toBe(6);

      for (let mask = 0; mask < 1 << count; mask++) {
        const mapState = createFakeMapState();
        // Apply this combination to the hash-persisted stateKeys.
        HASH_DEFS.forEach((def, i) => {
          mapState[def.stateKey] = (mask & (1 << i)) !== 0;
        });

        // currentHashState-style build: loop TOGGLES with hashKey.
        const state: CameraHashState = {};
        for (const def of TOGGLES) {
          if (!def.hashKey) continue;
          state[def.hashKey] = mapState[def.stateKey];
        }

        const parsed = parseHash(serializeHash(state));

        // applyHashToggles-style read into a fresh state.
        const restored = createFakeMapState();
        for (const def of TOGGLES) {
          if (!def.hashKey) continue;
          const value = parsed[def.hashKey];
          if (typeof value !== "boolean") continue;
          restored[def.stateKey] = value;
        }

        // The six hash-persisted booleans survive the round-trip.
        for (const def of HASH_DEFS) {
          expect(restored[def.stateKey]).toBe(mapState[def.stateKey]);
        }
      }
    });

    it("never serializes earthquakes/iss/measure", () => {
      for (let mask = 0; mask < 1 << 9; mask++) {
        const mapState = createFakeMapState();
        TOGGLES.forEach((def, i) => {
          mapState[def.stateKey] = (mask & (1 << i)) !== 0;
        });

        const state: CameraHashState = {};
        for (const def of TOGGLES) {
          if (!def.hashKey) continue;
          state[def.hashKey] = mapState[def.stateKey];
        }

        const hash = serializeHash(state);
        expect(hash).not.toContain("earthquake");
        expect(hash).not.toContain("iss");
        expect(hash).not.toContain("measure");
      }
    });
  });
});
