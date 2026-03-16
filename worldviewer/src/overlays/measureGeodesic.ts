/**
 * Pure geodesic math for the measurement tool.
 * No MapLibre dependency — independently testable.
 */

export type LngLat = { lng: number; lat: number };

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1_609.344;

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------

/** Great-circle distance in meters between two points using the Haversine formula. */
export function geodesicDistanceMeters(a: LngLat, b: LngLat): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Initial bearing
// ---------------------------------------------------------------------------

/** Initial bearing in degrees (0-360, clockwise from north) from `from` to `to`. */
export function geodesicBearing(from: LngLat, to: LngLat): number {
  const lat1 = from.lat * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const dLng = (to.lng - from.lng) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  const bearing = Math.atan2(y, x) * RAD_TO_DEG;
  return ((bearing % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Intermediate points (Sinnott formula)
// ---------------------------------------------------------------------------

/**
 * Generate intermediate points along the great circle for smooth rendering.
 * Returns `segments + 1` points (including endpoints).
 * If `a` and `b` are the same point, returns a single-element array.
 */
export function geodesicIntermediatePoints(a: LngLat, b: LngLat, segments: number): LngLat[] {
  const lat1 = a.lat * DEG_TO_RAD;
  const lng1 = a.lng * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const lng2 = b.lng * DEG_TO_RAD;

  // Central angle via Haversine
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const d = 2 * Math.asin(Math.sqrt(h));

  // Same point or negligible distance
  if (d < 1e-10) {
    return [{ lng: a.lng, lat: a.lat }];
  }

  const n = Math.max(1, segments);
  const points: LngLat[] = [];
  const sinD = Math.sin(d);

  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / sinD;
    const B = Math.sin(f * d) / sinD;

    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);

    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD_TO_DEG;
    const lng = Math.atan2(y, x) * RAD_TO_DEG;

    points.push({ lng, lat });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format distance for display: "1,234 m (4,049 ft)" or "12.3 km (7.6 mi)". */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    const m = Math.round(meters);
    const ft = Math.round(meters / METERS_PER_FOOT);
    return `${m.toLocaleString("en-US")} m (${ft.toLocaleString("en-US")} ft)`;
  }
  const km = meters / 1000;
  const mi = meters / METERS_PER_MILE;
  return `${km.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km (${mi.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi)`;
}

/** Format bearing for display: "045.2°" (zero-padded to 3 digits, one decimal). */
export function formatBearing(degrees: number): string {
  const fixed = degrees.toFixed(1);
  const padded = fixed.padStart(5, "0");
  return `${padded}\u00B0`;
}
