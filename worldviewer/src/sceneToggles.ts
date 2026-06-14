import type { Map } from "maplibre-gl";
import type { MapState } from "./mapState";
import type { SceneSyncDeps } from "./sceneSync";
import {
  syncViewState,
  syncSceneOverlays,
  setReliefVisibility,
  setLayerVisibility,
  spinGlobe,
  currentTerrainOptions
} from "./sceneSync";
import { BUILDING_LAYER_ID, FLAT_BUILDING_LAYER_ID } from "./mapStyle";

/** The six toggle keys that are persisted in the URL hash. */
export type ToggleHashKey =
  | "terrain"
  | "relief"
  | "night"
  | "weather"
  | "buildings"
  | "spin";

/** The boolean fields of MapState that scene toggles flip. */
type ToggleStateKey =
  | "terrainEnabled"
  | "reliefEnabled"
  | "nightEnabled"
  | "weatherEnabled"
  | "earthquakeEnabled"
  | "issEnabled"
  | "buildingsEnabled"
  | "autoSpinEnabled"
  | "measureEnabled";

/** Effect dependencies injected into a toggle effect so the table is unit-testable. */
export type ToggleEffectDeps = {
  map: Map;
  mapState: MapState;
  sceneSyncDeps: SceneSyncDeps;
  syncTimeScrubberVisibility: () => void;
};

export interface ToggleDef {
  /** The `data-toggle` chip name. */
  name: string;
  /** The boolean MapState field this toggle flips. */
  stateKey: ToggleStateKey;
  /** The URL-hash key, if this toggle is persisted (6 of 9 are). */
  hashKey?: ToggleHashKey;
  /** Status-pill text for the given on/off state. */
  status(on: boolean): string;
  /**
   * Side-effect to run after the state has been flipped.
   * INVARIANT: effects must NOT write the status pill — the caller assigns the
   * toggle's `status` text after the effect, and that assignment must stay
   * authoritative (the original wireToggles set status before the effect).
   */
  effect(on: boolean, deps: ToggleEffectDeps): void;
}

/**
 * Single source of truth for the 9 scene chip toggles. Status strings are copied
 * verbatim from the original wireToggles switch and are asserted by e2e specs.
 */
export const TOGGLES: ToggleDef[] = [
  {
    name: "terrain",
    stateKey: "terrainEnabled",
    hashKey: "terrain",
    status: (on) => (on ? "Terrain enabled." : "Terrain flattened."),
    effect: (on, { map, mapState, sceneSyncDeps }) => {
      map.setTerrain(on ? currentTerrainOptions(map, mapState) : null);
      syncViewState(map, sceneSyncDeps);
    }
  },
  {
    name: "relief",
    stateKey: "reliefEnabled",
    hashKey: "relief",
    status: (on) => (on ? "Relief overlay enabled." : "Relief overlay hidden."),
    effect: (on, { map, mapState }) => {
      setReliefVisibility(map, on, mapState);
    }
  },
  {
    name: "night",
    stateKey: "nightEnabled",
    hashKey: "night",
    status: (on) => (on ? "Night overlay enabled." : "Night overlay hidden."),
    effect: (_on, { map, sceneSyncDeps, syncTimeScrubberVisibility }) => {
      syncSceneOverlays(map, sceneSyncDeps);
      syncTimeScrubberVisibility();
    }
  },
  {
    name: "weather",
    stateKey: "weatherEnabled",
    hashKey: "weather",
    status: (on) => (on ? "Weather radar enabled." : "Weather radar hidden."),
    effect: (_on, { map, sceneSyncDeps }) => {
      syncSceneOverlays(map, sceneSyncDeps);
    }
  },
  {
    name: "earthquakes",
    stateKey: "earthquakeEnabled",
    status: (on) => (on ? "Earthquake layer enabled." : "Earthquake layer hidden."),
    effect: (_on, { map, sceneSyncDeps }) => {
      syncSceneOverlays(map, sceneSyncDeps);
    }
  },
  {
    name: "iss",
    stateKey: "issEnabled",
    status: (on) => (on ? "ISS tracker enabled." : "ISS tracker hidden."),
    effect: (_on, { map, sceneSyncDeps }) => {
      syncSceneOverlays(map, sceneSyncDeps);
    }
  },
  {
    name: "buildings",
    stateKey: "buildingsEnabled",
    hashKey: "buildings",
    status: (on) => (on ? "3D buildings enabled." : "Buildings hidden."),
    effect: (on, { map, sceneSyncDeps }) => {
      setLayerVisibility(map, BUILDING_LAYER_ID, on);
      setLayerVisibility(map, FLAT_BUILDING_LAYER_ID, on);
      syncViewState(map, sceneSyncDeps);
    }
  },
  {
    name: "spin",
    stateKey: "autoSpinEnabled",
    hashKey: "spin",
    status: (on) => (on ? "Orbital spin enabled." : "Orbital spin paused."),
    effect: (on, { map, mapState }) => {
      if (on) {
        spinGlobe(map, mapState);
      }
    }
  },
  {
    name: "measure",
    stateKey: "measureEnabled",
    status: (on) =>
      on
        ? "Measure mode: click two points to measure distance."
        : "Measure mode off.",
    effect: (_on, { map, sceneSyncDeps }) => {
      syncSceneOverlays(map, sceneSyncDeps);
    }
  }
];

export type DispatchToggleResult = {
  name: string;
  on: boolean;
  status: string;
  hashKey?: ToggleHashKey;
};

/**
 * The single state-mutation + side-effect site for scene toggles. Looks up the
 * toggle by name, flips its MapState boolean, runs its effect, and returns the
 * resulting state. Returns null (mutating nothing) for an unknown name.
 */
export function dispatchToggle(
  name: string,
  deps: ToggleEffectDeps
): DispatchToggleResult | null {
  const def = TOGGLES.find((t) => t.name === name);
  if (!def) {
    return null;
  }

  const on = !deps.mapState[def.stateKey];
  deps.mapState[def.stateKey] = on;
  def.effect(on, deps);

  return {
    name: def.name,
    on,
    status: def.status(on),
    hashKey: def.hashKey
  };
}
