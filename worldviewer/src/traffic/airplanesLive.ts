import { deriveFlightCode } from "./trafficHelpers";
import type { Bbox, LiveTrack } from "./trafficTypes";

/**
 * airplanes.live live-aircraft source. Unlike OpenSky (which blocks browser
 * cross-origin requests and datacenter IPs), airplanes.live serves
 * `Access-Control-Allow-Origin: *`, so the browser fetches it directly — no
 * proxy, no auth. Query is centre + radius (nautical miles, max 250).
 */
const AIRPLANES_LIVE_BASE = "https://api.airplanes.live/v2";
const FEET_TO_METERS = 0.3048;
const MAX_RADIUS_NM = 250;
const EARTH_RADIUS_NM = 3440.065;

export function airplanesLiveUrl(bbox: Bbox): string {
  const [west, south, east, north] = bbox;
  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;
  const radiusNm = Math.min(
    MAX_RADIUS_NM,
    Math.max(1, Math.ceil(greatCircleNm(centerLat, centerLng, north, east)))
  );
  return `${AIRPLANES_LIVE_BASE}/point/${centerLat.toFixed(5)}/${centerLng.toFixed(5)}/${radiusNm}`;
}

function greatCircleNm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function parseAirplanesLive(data: unknown, now: number = Date.now()): LiveTrack[] {
  if (typeof data !== "object" || data === null) {
    return [];
  }

  const ac = (data as { ac?: unknown }).ac;
  if (!Array.isArray(ac)) {
    return [];
  }

  const tracks: LiveTrack[] = [];
  for (const entry of ac) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const a = entry as Record<string, unknown>;

    // Stable id (icao24 hex). Drop entries without one (see L2 rationale).
    const id = typeof a.hex === "string" ? a.hex.trim().toLowerCase() : "";
    if (id.length === 0) {
      continue;
    }

    const lng = a.lon;
    const lat = a.lat;
    if (typeof lng !== "number" || !Number.isFinite(lng) || typeof lat !== "number" || !Number.isFinite(lat)) {
      continue;
    }

    const onGround = a.alt_baro === "ground";
    const callsign = normalizeCallsign(a.flight);
    const flightCode = deriveFlightCode(callsign);

    tracks.push({
      id,
      kind: "aircraft",
      lng,
      lat,
      heading: firstFiniteNumber([a.track, a.true_heading, a.mag_heading]),
      // airplanes.live ground speed is already in knots.
      speedKnots: finiteOrNull(a.gs),
      // Altitudes are in feet; convert to metres. On ground -> no barometric alt.
      altitudeMeters: onGround ? null : feetToMetersOrNull(a.alt_baro),
      label: flightCode ?? callsign,
      source: "airplaneslive",
      updatedAt: now,
      onGround,
      callsign,
      flightCode,
      aircraftCategory: mapEmitterCategory(a.category),
      geoAltitudeMeters: feetToMetersOrNull(a.alt_geom),
      // ICAO type designator (e.g. "B738") — OpenSky's states feed never had this;
      // it sharpens 3D class selection. Identity shards still enrich by hex.
      aircraftTypeCode: nonEmptyString(a.t),
      registration: nonEmptyString(a.r)
    });
  }

  return tracks;
}

function normalizeCallsign(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function feetToMetersOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value * FEET_TO_METERS : null;
}

function firstFiniteNumber(values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Map an ADS-B emitter category ("A1".."A7", "B1".."B4") to the numeric index
 * used by selectAircraft3dClass (the same scale OpenSky used: A1=2 light .. A7=8
 * rotorcraft, B1=9 glider ..). Unknown/surface categories -> null.
 */
function mapEmitterCategory(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([ABC])([0-7])$/.exec(value.trim().toUpperCase());
  if (!match) return null;
  const letter = match[1];
  const digit = Number(match[2]);
  if (letter === "A") {
    return digit === 0 ? 1 : digit + 1; // A1->2 .. A7->8
  }
  if (letter === "B") {
    return digit === 0 ? 1 : digit >= 1 && digit <= 4 ? digit + 8 : null; // B1->9 .. B4->12
  }
  return null; // C* surface/obstacle
}
