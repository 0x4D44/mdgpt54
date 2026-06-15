import type { LiveTrack } from "./trafficTypes";

/** Mean earth radius in metres, matching the great-circle convention used elsewhere. */
const EARTH_RADIUS_M = 6_371_000;

/** Knots to metres-per-second conversion factor (1 knot = 1852 m / 3600 s). */
const KNOTS_TO_M_PER_S = 0.514444;

/**
 * Default cap on how far ahead a track may be extrapolated. Aircraft positions
 * are dead-reckoned between 15s polls; if polling stalls we still stop flying
 * planes forever once this much time has elapsed since the last fix.
 */
export const MAX_EXTRAPOLATION_MS = 30_000;

/**
 * Great-circle destination point: start at (lat, lng), travel distanceMeters
 * along the given compass bearing (degrees, 0 = north). Returns the new
 * { lat, lng } in degrees.
 */
export function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceMeters: number
): { lat: number; lng: number } {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAngular = Math.sin(angular);
  const cosAngular = Math.cos(angular);

  const sinLat2 = sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearing);
  const lat2 = Math.asin(sinLat2);
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * sinAngular * cosLat1,
      cosAngular - sinLat1 * sinLat2
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Dead-reckon a single track forward by elapsedMs along its heading at its
 * reported ground speed. Tracks that are on the ground, or lack a heading or a
 * usable speed, are returned unchanged. Otherwise a cloned track with updated
 * lng/lat is returned; every other field is identical.
 */
export function extrapolateTrack(
  track: LiveTrack,
  elapsedMs: number,
  maxExtrapolationMs: number
): LiveTrack {
  if (track.onGround || track.heading === null || track.speedKnots === null || track.speedKnots <= 0) {
    return track;
  }

  const cappedMs = clamp(elapsedMs, 0, maxExtrapolationMs);
  const distanceMeters = track.speedKnots * KNOTS_TO_M_PER_S * (cappedMs / 1000);
  const { lat, lng } = destinationPoint(track.lat, track.lng, track.heading, distanceMeters);

  return { ...track, lat, lng };
}

/**
 * Extrapolate every track to nowMs, using each track's own updatedAt as the
 * starting fix time.
 */
export function extrapolateTracks(
  tracks: LiveTrack[],
  nowMs: number,
  maxExtrapolationMs: number
): LiveTrack[] {
  return tracks.map((track) => extrapolateTrack(track, nowMs - track.updatedAt, maxExtrapolationMs));
}
