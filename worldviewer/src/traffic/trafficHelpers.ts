import type { Bbox, LiveTrack, SnapshotMessage } from "./trafficTypes";

/** Stale threshold in milliseconds — tracks older than this get faded. */
export const STALE_THRESHOLD_MS = 60_000;
export const MIN_LIVE_TRAFFIC_ZOOM = 5;

export type TrafficToggleState = {
  aircraftEnabled: boolean;
  shipsEnabled: boolean;
};

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
export function tracksToGeoJSON(tracks: LiveTrack[], now: number): GeoJSON.FeatureCollection {
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
        opacity: trackOpacity(track, now)
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

export function getLowZoomTrafficHint(state: TrafficToggleState, zoom: number): string | null {
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
