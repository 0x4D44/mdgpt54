import type { Bbox, LiveTrack, SnapshotMessage } from "./trafficTypes";
import { formatAircraftModelDescription } from "./aircraftIdentityData";

/** Stale threshold in milliseconds — tracks older than this get faded. */
export const STALE_THRESHOLD_MS = 60_000;
export const MIN_LIVE_TRAFFIC_ZOOM = 5;
const FLIGHT_CODE_CALLSIGN_RE = /^([A-Z]{3})(\d{1,4}[A-Z]?)$/;
const EMPTY_TRACK_ID_SET = new Set<string>();
const AIRCRAFT_CATEGORY_LABELS: Record<number, string> = {
  2: "Light",
  3: "Small",
  4: "Large",
  5: "High-vortex large",
  6: "Heavy",
  7: "High-performance",
  8: "Rotorcraft",
  9: "Glider / sailplane",
  10: "Lighter-than-air",
  11: "Parachutist",
  12: "Ultralight",
  13: "Reserved",
  14: "UAV",
  15: "Space vehicle",
  16: "Emergency vehicle",
  17: "Service vehicle",
  18: "Point obstacle",
  19: "Cluster obstacle",
  20: "Line obstacle"
};

export type TrafficToggleState = {
  aircraftEnabled: boolean;
  shipsEnabled: boolean;
};

export type AircraftVisualCategory = "generic" | "light" | "transport" | "fast" | "rotor" | "glider";

/** Extract a canonical [west, south, east, north] bbox from MapLibre bounds. */
export function bboxFromBounds(bounds: {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}): Bbox {
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

/** Returns true if a track's updatedAt is older than the stale threshold relative to now. */
export function isTrackStale(track: LiveTrack, now: number): boolean {
  return now - track.updatedAt > STALE_THRESHOLD_MS;
}

/** Compute an opacity value for a track: 1.0 if fresh, fading to 0.3 as it approaches 2× stale threshold. */
export function trackOpacity(track: LiveTrack, now: number): number {
  const age = now - track.updatedAt;
  if (age <= 0) return 1;
  if (age >= STALE_THRESHOLD_MS * 2) return 0.3;
  return 1 - (age / (STALE_THRESHOLD_MS * 2)) * 0.7;
}

/** Convert an array of LiveTracks into a GeoJSON FeatureCollection for MapLibre. */
export function tracksToGeoJSON(
  tracks: LiveTrack[],
  now: number,
  hiddenTrackIds: ReadonlySet<string> = EMPTY_TRACK_ID_SET
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: tracks.map((track) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [track.lng, track.lat]
      },
      properties: {
        id: track.id,
        kind: track.kind,
        heading: track.heading,
        speedKnots: track.speedKnots,
        altitudeMeters: track.altitudeMeters,
        label: track.label,
        source: track.source,
        updatedAt: track.updatedAt,
        onGround: track.onGround ?? null,
        callsign: track.callsign ?? null,
        flightCode: track.flightCode ?? null,
        aircraftCategory: track.aircraftCategory ?? null,
        geoAltitudeMeters: track.geoAltitudeMeters ?? null,
        aircraftTypeCode: track.aircraftTypeCode ?? null,
        registration: track.registration ?? null,
        manufacturer: track.manufacturer ?? null,
        model: track.model ?? null,
        renderModelKey: track.renderModelKey ?? null,
        aircraftVisualCategory:
          track.kind === "aircraft" ? getAircraftVisualCategory(track.aircraftCategory ?? null) : null,
        opacity: track.kind === "aircraft" && hiddenTrackIds.has(track.id) ? 0 : trackOpacity(track, now)
      }
    }))
  };
}

/** Format a unix timestamp as a relative "Xs ago" / "Xm ago" string. */
export function formatAge(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

/** Format speed in knots with one decimal. */
export function formatSpeed(knots: number | null): string | null {
  if (knots === null) return null;
  return `${knots.toFixed(1)} kn`;
}

/** Format altitude in meters as a rounded string. */
export function formatAltitude(meters: number | null): string | null {
  if (meters === null) return null;
  return `${Math.round(meters)} m`;
}

export function formatAircraftAltitude(
  track: Pick<LiveTrack, "altitudeMeters" | "geoAltitudeMeters">,
  includeSource: boolean = false
): string | null {
  const usesGeoAltitude = track.geoAltitudeMeters !== null && track.geoAltitudeMeters !== undefined;
  const altitude = formatAltitude(usesGeoAltitude ? track.geoAltitudeMeters ?? null : track.altitudeMeters ?? null);
  if (!altitude || !includeSource) {
    return altitude;
  }

  return `${altitude} (${usesGeoAltitude ? "geo" : "baro"})`;
}

export function deriveFlightCode(callsign: string | null | undefined): string | null {
  if (typeof callsign !== "string") {
    return null;
  }

  const trimmed = callsign.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = FLIGHT_CODE_CALLSIGN_RE.exec(trimmed);
  if (!match) {
    return null;
  }

  return `${match[1]} ${match[2]}`;
}

export function getAircraftCategoryLabel(category: number | null | undefined): string | null {
  if (typeof category !== "number") {
    return null;
  }

  return AIRCRAFT_CATEGORY_LABELS[category] ?? null;
}

export function getAircraftVisualCategory(category: number | null | undefined): AircraftVisualCategory {
  switch (category) {
    case 2:
    case 3:
    case 12:
      return "light";
    case 4:
    case 5:
    case 6:
      return "transport";
    case 7:
      return "fast";
    case 8:
      return "rotor";
    case 9:
    case 10:
    case 11:
      return "glider";
    default:
      return "generic";
  }
}

export function buildAircraftPopupIdentity(track: {
  id: string;
  label: string | null;
  callsign?: string | null;
  flightCode?: string | null;
  registration?: string | null;
  aircraftTypeCode?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  aircraftCategory?: number | null;
}): { title: string; rows: string[] } {
  const title = firstText(track.flightCode, track.callsign, track.registration, track.label, track.id) ?? track.id;
  const rows: string[] = [];

  if (hasText(track.callsign) && track.callsign !== title) {
    rows.push(`Callsign ${track.callsign.trim()}`);
  }

  if (hasText(track.registration) && track.registration !== title) {
    rows.push(`Registration ${track.registration.trim()}`);
  }

  const modelDescription = formatAircraftModelDescription(track.manufacturer ?? null, track.model ?? null);
  if (modelDescription) {
    rows.push(modelDescription);
  }

  if (hasText(track.aircraftTypeCode)) {
    rows.push(`Type ${track.aircraftTypeCode.trim().toUpperCase()}`);
  }

  const categoryLabel = getAircraftCategoryLabel(track.aircraftCategory ?? null);
  if (categoryLabel) {
    rows.push(`Category ${categoryLabel}`);
  }

  return { title, rows };
}

/** Validate and parse a snapshot message from the relay. Returns null if invalid. */
export function parseSnapshot(data: unknown): SnapshotMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== "snapshot") return null;
  if (!Array.isArray(msg.aircraft) || !Array.isArray(msg.ships)) return null;
  if (typeof msg.serverTime !== "number") return null;
  if (typeof msg.status !== "object" || msg.status === null) return null;
  return data as SnapshotMessage;
}

export function resolveEffectiveTrafficLayers(
  state: TrafficToggleState,
  zoom: number
): TrafficToggleState {
  if (zoom < MIN_LIVE_TRAFFIC_ZOOM) {
    return {
      aircraftEnabled: false,
      shipsEnabled: false
    };
  }

  return state;
}

export function isStaticTrafficHost(hostname: string): boolean {
  return hostname.endsWith("github.io");
}

export function getTrafficClientHint(
  state: TrafficToggleState,
  zoom: number,
  _hostname: string
): string | null {
  if (!state.aircraftEnabled && !state.shipsEnabled) {
    return null;
  }

  if (zoom >= MIN_LIVE_TRAFFIC_ZOOM) {
    return null;
  }

  return `Zoom in past ${MIN_LIVE_TRAFFIC_ZOOM.toFixed(0)} to activate live traffic.`;
}

/** Create a debounced function that delays invocation by the given ms. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  return debounced as unknown as T;
}

/** Altitude band color stops used by both the 2D MapLibre expression and the 3D material tint. */
export const ALTITUDE_COLOR_STOPS: ReadonlyArray<{ altitude: number; color: string }> = [
  { altitude: 0, color: "#4ade80" },
  { altitude: 1500, color: "#4ade80" },
  { altitude: 1500, color: "#facc15" },
  { altitude: 6000, color: "#facc15" },
  { altitude: 6000, color: "#67d0ff" },
  { altitude: 10000, color: "#67d0ff" },
  { altitude: 10000, color: "#3b82f6" },
  { altitude: 13000, color: "#3b82f6" },
  { altitude: 13000, color: "#a78bfa" }
];

/**
 * Returns a MapLibre interpolate expression that colors aircraft icons by altitude band.
 * Uses coalesce to prefer geoAltitudeMeters over altitudeMeters, falling back to 0.
 */
export function altitudeColorExpression(): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "geoAltitudeMeters"], ["get", "altitudeMeters"], 0],
    ...ALTITUDE_COLOR_STOPS.flatMap((stop) => [stop.altitude, stop.color])
  ];
}

/** Returns the hex color for a given altitude in meters, using the same bands as the 2D expression. */
export function altitudeColor(altitudeMeters: number): string {
  if (altitudeMeters <= 1500) return "#4ade80";
  if (altitudeMeters <= 6000) return "#facc15";
  if (altitudeMeters <= 10000) return "#67d0ff";
  if (altitudeMeters <= 13000) return "#3b82f6";
  return "#a78bfa";
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (hasText(value)) {
      return value.trim();
    }
  }

  return null;
}
