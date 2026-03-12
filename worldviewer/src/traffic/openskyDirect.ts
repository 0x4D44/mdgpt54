import { deriveFlightCode } from "./trafficHelpers";
import type { Bbox, LiveTrack } from "./trafficTypes";

const MPS_TO_KNOTS = 1.94384;
const STATE_ICAO24 = 0;
const STATE_CALLSIGN = 1;
const STATE_LONGITUDE = 5;
const STATE_LATITUDE = 6;
const STATE_BARO_ALTITUDE = 7;
const STATE_VELOCITY = 9;
const STATE_TRUE_TRACK = 10;
const STATE_GEO_ALTITUDE = 13;
const STATE_CATEGORY = 17;

export function openSkyUrl(bbox: Bbox): string {
  const [west, south, east, north] = bbox;
  return (
    "https://opensky-network.org/api/states/all" +
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

    const velocityMps = typeof state[STATE_VELOCITY] === "number" ? state[STATE_VELOCITY] : null;
    const callsign = normalizeCallsign(state[STATE_CALLSIGN]);
    const flightCode = deriveFlightCode(callsign);

    tracks.push({
      id: typeof state[STATE_ICAO24] === "string" ? state[STATE_ICAO24] : `${lng},${lat},${now}`,
      kind: "aircraft",
      lng,
      lat,
      heading: typeof state[STATE_TRUE_TRACK] === "number" ? state[STATE_TRUE_TRACK] : null,
      speedKnots: velocityMps === null ? null : velocityMps * MPS_TO_KNOTS,
      altitudeMeters: typeof state[STATE_BARO_ALTITUDE] === "number" ? state[STATE_BARO_ALTITUDE] : null,
      label: flightCode ?? callsign,
      source: "opensky",
      updatedAt: now,
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
