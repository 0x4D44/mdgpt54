import { MAX_BROWSER_ZOOM } from "./detailProfile";

export type CameraHashState = {
  lat?: number;
  lng?: number;
  z?: number;
  p?: number;
  b?: number;
  terrain?: boolean;
  night?: boolean;
  weather?: boolean;
  relief?: boolean;
  buildings?: boolean;
  spin?: boolean;
};

export const DEFAULTS: Required<CameraHashState> = {
  lat: 21,
  lng: 12,
  z: 1.2,
  p: 0,
  b: -10,
  terrain: true,
  buildings: true,
  relief: true,
  night: true,
  weather: false,
  spin: true
};

export const HASH_DEBOUNCE_MS = 400;

const NUMERIC_KEYS = new Set(["lat", "lng", "z", "p", "b"]);
const BOOLEAN_KEYS = new Set(["terrain", "night", "weather", "relief", "buildings", "spin"]);

/** Canonical serialisation order: camera first, then toggles. */
const KEY_ORDER: ReadonlyArray<keyof CameraHashState> = [
  "lat", "lng", "z", "p", "b",
  "terrain", "night", "weather", "relief", "buildings", "spin"
];

const PRECISION: Record<string, number> = {
  lat: 4,
  lng: 4,
  z: 1,
  p: 0,
  b: 0
};

const NUMERIC_RANGES: Record<string, [min: number, max: number]> = {
  lat: [-90, 90],
  lng: [-180, 180],
  z: [0, MAX_BROWSER_ZOOM],
  p: [0, 85],
  b: [-180, 180]
};

/** Clamp a parsed numeric value to the valid range for its key. */
function clampNumericKey(key: string, value: number): number {
  const range = NUMERIC_RANGES[key];
  if (!range) return value;
  return Math.max(range[0], Math.min(range[1], value));
}

/** Round a float to fixed decimals for URL brevity. */
export function roundForHash(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Parse a URL hash string into a partial CameraHashState. Returns empty object if hash is absent or malformed. */
export function parseHash(hash: string): CameraHashState {
  const state: CameraHashState = {};
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  if (stripped.length === 0) return state;

  for (const pair of stripped.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) continue;
    const key = pair.slice(0, eqIdx);
    const raw = pair.slice(eqIdx + 1);
    if (raw.length === 0) continue;

    if (NUMERIC_KEYS.has(key)) {
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      (state as Record<string, number>)[key] = clampNumericKey(key, num);
    } else if (BOOLEAN_KEYS.has(key)) {
      if (raw === "1") (state as Record<string, boolean>)[key] = true;
      else if (raw === "0") (state as Record<string, boolean>)[key] = false;
      // anything else is silently ignored
    }
    // unknown keys are silently ignored
  }

  return state;
}

/** Serialize a CameraHashState to a URL hash string, omitting keys that match DEFAULTS. Returns "" if all defaults. */
export function serializeHash(state: CameraHashState): string {
  const parts: string[] = [];

  for (const key of KEY_ORDER) {
    const value = state[key];
    if (value === undefined) continue;

    const defaultValue = DEFAULTS[key];
    if (NUMERIC_KEYS.has(key)) {
      const rounded = roundForHash(value as number, PRECISION[key]);
      if (rounded === defaultValue) continue;
      parts.push(`${key}=${rounded}`);
    } else {
      if (value === defaultValue) continue;
      parts.push(`${key}=${value ? 1 : 0}`);
    }
  }

  return parts.length > 0 ? `#${parts.join("&")}` : "";
}
