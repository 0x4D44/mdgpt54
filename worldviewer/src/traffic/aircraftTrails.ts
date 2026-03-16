import type { LiveTrack } from "./trafficTypes";

/** A single recorded position in an aircraft's trail. */
export type TrailPoint = { lng: number; lat: number; timestamp: number };

/** Max trail points per aircraft. At ~5s snapshot interval, 60 points ~ 5 minutes. */
export const MAX_TRAIL_POINTS = 60;

/** Trail entries older than this are pruned on update. */
export const TRAIL_MAX_AGE_MS = 5 * 60 * 1000;

export type TrailStore = {
  /** Ingest a fresh set of aircraft tracks. Appends positions and evicts stale/missing trails. */
  update(tracks: LiveTrack[], now: number): void;
  /** Convert current trail data to a GeoJSON FeatureCollection of LineStrings. */
  toGeoJSON(now: number): GeoJSON.FeatureCollection;
  /** Discard all trail data. */
  clear(): void;
};

export function createTrailStore(): TrailStore {
  const trails = new Map<string, TrailPoint[]>();

  return { update, toGeoJSON, clear };

  function update(tracks: LiveTrack[], now: number): void {
    const activeIds = new Set<string>();

    for (const track of tracks) {
      if (track.kind !== "aircraft") continue;

      activeIds.add(track.id);

      let points = trails.get(track.id);
      if (!points) {
        points = [];
        trails.set(track.id, points);
      }

      // Deduplicate: skip if position matches the most recent point
      const last = points[points.length - 1];
      if (!last || last.lng !== track.lng || last.lat !== track.lat) {
        points.push({ lng: track.lng, lat: track.lat, timestamp: now });

        // Ring buffer: drop oldest when over capacity
        if (points.length > MAX_TRAIL_POINTS) {
          points.shift();
        }
      }

      // Age-based pruning: remove points older than TRAIL_MAX_AGE_MS
      while (points.length > 0 && now - points[0].timestamp > TRAIL_MAX_AGE_MS) {
        points.shift();
      }
    }

    // Evict trails for aircraft no longer in the snapshot
    for (const id of trails.keys()) {
      if (!activeIds.has(id)) {
        trails.delete(id);
      }
    }
  }

  function toGeoJSON(now: number): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];

    for (const [id, points] of trails) {
      if (points.length < 2) continue;

      const newestTimestamp = points[points.length - 1].timestamp;
      const age = now - newestTimestamp;
      // Opacity: 0.6 when fresh, fading to 0.15 at max age
      const opacity = Math.max(0.15, 0.6 - (age / TRAIL_MAX_AGE_MS) * 0.45);

      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: points.map((p) => [p.lng, p.lat])
        },
        properties: {
          id,
          opacity: Math.round(opacity * 1000) / 1000
        }
      });
    }

    return { type: "FeatureCollection", features };
  }

  function clear(): void {
    trails.clear();
  }
}
