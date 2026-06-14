import { deriveFlightCode } from "./trafficHelpers";
import type { Bbox, LiveTrack } from "./trafficTypes";

const MPS_TO_KNOTS = 1.94384;

/**
 * Base origin for the OpenSky API. OpenSky's anonymous API sends
 * `Access-Control-Allow-Origin: https://opensky-network.org`, which browsers
 * block for any other page origin, so a same-origin CORS proxy is required to
 * use it from the browser (see worker/opensky-proxy.js). Set VITE_OPENSKY_BASE
 * to the proxy origin at build time; defaults to OpenSky directly (works only
 * when the page is served from opensky-network.org, i.e. effectively never here).
 */
const OPENSKY_BASE_RAW = import.meta.env.VITE_OPENSKY_BASE;
export const OPENSKY_API_BASE =
  typeof OPENSKY_BASE_RAW === "string" && OPENSKY_BASE_RAW.trim().length > 0
    ? OPENSKY_BASE_RAW.replace(/\/+$/, "")
    : "https://opensky-network.org";

const STATE_ICAO24 = 0;
const STATE_CALLSIGN = 1;
const STATE_LONGITUDE = 5;
const STATE_LATITUDE = 6;
const STATE_BARO_ALTITUDE = 7;
const STATE_ON_GROUND = 8;
const STATE_VELOCITY = 9;
const STATE_TRUE_TRACK = 10;
const STATE_GEO_ALTITUDE = 13;
const STATE_CATEGORY = 17;

export function openSkyUrl(bbox: Bbox): string {
  const [west, south, east, north] = bbox;
  return (
    `${OPENSKY_API_BASE}/api/states/all` +
    `?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}&extended=1`
  );
}

export function parseOpenSkyStates(data: unknown, now: number = Date.now()): LiveTrack[] {
  if (typeof data !== "object" || data === null) {
    return [];
  }

  const states = (data as { states?: unknown }).states;
  if (!Array.isArray(states)) {
    return [];
  }

  const tracks: LiveTrack[] = [];
  for (const state of states) {
    if (!Array.isArray(state)) {
      continue;
    }

    const lng = state[STATE_LONGITUDE];
    const lat = state[STATE_LATITUDE];
    if (typeof lng !== "number" || typeof lat !== "number") {
      continue;
    }

    // Require a stable id (icao24). A synthetic id would change every poll,
    // producing orphaned single-point trails and churning 3D objects, so drop
    // rows without one. Real OpenSky rows always carry a string icao24.
    const id = typeof state[STATE_ICAO24] === "string" ? state[STATE_ICAO24].trim() : "";
    if (id.length === 0) {
      continue;
    }

    const velocityMps = typeof state[STATE_VELOCITY] === "number" ? state[STATE_VELOCITY] : null;
    const callsign = normalizeCallsign(state[STATE_CALLSIGN]);
    const flightCode = deriveFlightCode(callsign);

    tracks.push({
      id,
      kind: "aircraft",
      lng,
      lat,
      heading: typeof state[STATE_TRUE_TRACK] === "number" ? state[STATE_TRUE_TRACK] : null,
      speedKnots: velocityMps === null ? null : velocityMps * MPS_TO_KNOTS,
      altitudeMeters: typeof state[STATE_BARO_ALTITUDE] === "number" ? state[STATE_BARO_ALTITUDE] : null,
      label: flightCode ?? callsign,
      source: "opensky",
      updatedAt: now,
      onGround: typeof state[STATE_ON_GROUND] === "boolean" ? state[STATE_ON_GROUND] : null,
      callsign,
      flightCode,
      aircraftCategory: typeof state[STATE_CATEGORY] === "number" ? state[STATE_CATEGORY] : null,
      geoAltitudeMeters: typeof state[STATE_GEO_ALTITUDE] === "number" ? state[STATE_GEO_ALTITUDE] : null
    });
  }

  return tracks;
}

function normalizeCallsign(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
