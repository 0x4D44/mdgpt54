import { describe, expect, it } from "vitest";

import type { LiveTrack } from "./trafficTypes";
import {
  createTrailStore,
  MAX_TRAIL_POINTS,
  TRAIL_MAX_AGE_MS
} from "./aircraftTrails";

function makeAircraft(overrides: Partial<LiveTrack> = {}): LiveTrack {
  return {
    id: "ac-1",
    kind: "aircraft",
    lng: -3.19,
    lat: 55.95,
    heading: 90,
    speedKnots: 240,
    altitudeMeters: 10000,
    label: "Test",
    source: "opensky",
    updatedAt: 1000,
    ...overrides
  };
}

function makeShip(overrides: Partial<LiveTrack> = {}): LiveTrack {
  return {
    id: "ship-1",
    kind: "ship",
    lng: -3.19,
    lat: 55.95,
    heading: 180,
    speedKnots: 12,
    altitudeMeters: null,
    label: "Vessel",
    source: "aisstream",
    updatedAt: 1000,
    ...overrides
  };
}

describe("TrailStore", () => {
  describe("update", () => {
    it("adds trail points for aircraft tracks", () => {
      const store = createTrailStore();
      const tracks = [makeAircraft({ id: "ac-1", lng: 1, lat: 2 })];

      store.update(tracks, 1000);

      const geo = store.toGeoJSON(1000);
      // Only 1 point so far, need at least 2 for a LineString — no features yet
      expect(geo.features).toHaveLength(0);
    });

    it("ignores non-aircraft tracks (ships)", () => {
      const store = createTrailStore();
      const tracks = [makeShip({ id: "ship-1", lng: 1, lat: 2 })];

      store.update(tracks, 1000);
      store.update(tracks, 2000);

      const geo = store.toGeoJSON(2000);
      expect(geo.features).toHaveLength(0);
    });

    it("accumulates positions across repeated updates", () => {
      const store = createTrailStore();

      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 1000);
      store.update([makeAircraft({ id: "ac-1", lng: 1.1, lat: 2.1 })], 6000);
      store.update([makeAircraft({ id: "ac-1", lng: 1.2, lat: 2.2 })], 11000);

      const geo = store.toGeoJSON(11000);
      expect(geo.features).toHaveLength(1);
      const coords = (geo.features[0].geometry as GeoJSON.LineString).coordinates;
      expect(coords).toHaveLength(3);
      expect(coords[0]).toEqual([1, 2]);
      expect(coords[1]).toEqual([1.1, 2.1]);
      expect(coords[2]).toEqual([1.2, 2.2]);
    });

    it("prunes points older than max age", () => {
      const store = createTrailStore();

      const baseTime = 100000;
      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], baseTime);
      store.update(
        [makeAircraft({ id: "ac-1", lng: 2, lat: 3 })],
        baseTime + TRAIL_MAX_AGE_MS + 1
      );

      const geo = store.toGeoJSON(baseTime + TRAIL_MAX_AGE_MS + 1);
      // The old point should have been pruned, leaving only 1 point — not enough for a line
      expect(geo.features).toHaveLength(0);
    });

    it("enforces ring buffer capacity (MAX_TRAIL_POINTS)", () => {
      const store = createTrailStore();

      // Fill beyond capacity, all within max age window
      const baseTime = 100000;
      for (let i = 0; i <= MAX_TRAIL_POINTS; i++) {
        store.update(
          [makeAircraft({ id: "ac-1", lng: i, lat: i })],
          baseTime + i * 1000
        );
      }

      const now = baseTime + MAX_TRAIL_POINTS * 1000;
      const geo = store.toGeoJSON(now);
      expect(geo.features).toHaveLength(1);
      const coords = (geo.features[0].geometry as GeoJSON.LineString).coordinates;
      expect(coords).toHaveLength(MAX_TRAIL_POINTS);
      // Oldest point (index 0) should have been shifted out
      expect(coords[0]).toEqual([1, 1]);
    });

    it("evicts trails for aircraft no longer in the snapshot", () => {
      const store = createTrailStore();

      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 1000);
      store.update([makeAircraft({ id: "ac-1", lng: 1.1, lat: 2.1 })], 6000);

      // ac-1 is gone from the snapshot
      store.update([makeAircraft({ id: "ac-2", lng: 5, lat: 5 })], 11000);

      const geo = store.toGeoJSON(11000);
      // ac-1 evicted (gone), ac-2 has only 1 point (not enough)
      expect(geo.features).toHaveLength(0);
    });

    it("deduplicates stationary aircraft (same position)", () => {
      const store = createTrailStore();

      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 1000);
      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 6000);
      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 11000);

      const geo = store.toGeoJSON(11000);
      // All same position — only 1 unique point stored, not enough for a line
      expect(geo.features).toHaveLength(0);
    });

    it("tracks multiple aircraft independently", () => {
      const store = createTrailStore();

      store.update(
        [
          makeAircraft({ id: "ac-1", lng: 1, lat: 2 }),
          makeAircraft({ id: "ac-2", lng: 10, lat: 20 })
        ],
        1000
      );
      store.update(
        [
          makeAircraft({ id: "ac-1", lng: 1.1, lat: 2.1 }),
          makeAircraft({ id: "ac-2", lng: 10.1, lat: 20.1 })
        ],
        6000
      );

      const geo = store.toGeoJSON(6000);
      expect(geo.features).toHaveLength(2);
    });
  });

  describe("toGeoJSON", () => {
    it("returns LineString features with coordinates from trail history", () => {
      const store = createTrailStore();

      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 1000);
      store.update([makeAircraft({ id: "ac-1", lng: 3, lat: 4 })], 6000);

      const geo = store.toGeoJSON(6000);
      expect(geo.type).toBe("FeatureCollection");
      expect(geo.features).toHaveLength(1);

      const feature = geo.features[0];
      expect(feature.type).toBe("Feature");
      expect(feature.geometry.type).toBe("LineString");
      expect((feature.geometry as GeoJSON.LineString).coordinates).toEqual([
        [1, 2],
        [3, 4]
      ]);
    });

    it("returns empty FeatureCollection when no trails exist", () => {
      const store = createTrailStore();

      const geo = store.toGeoJSON(1000);
      expect(geo).toEqual({ type: "FeatureCollection", features: [] });
    });

    it("excludes trails with only 1 point (need at least 2 for a line)", () => {
      const store = createTrailStore();

      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 1000);

      const geo = store.toGeoJSON(1000);
      expect(geo.features).toHaveLength(0);
    });

    it("includes opacity property based on trail freshness", () => {
      const store = createTrailStore();
      const now = 100000;

      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], now - 10000);
      store.update([makeAircraft({ id: "ac-1", lng: 2, lat: 3 })], now);

      const geo = store.toGeoJSON(now);
      expect(geo.features).toHaveLength(1);

      const props = geo.features[0].properties!;
      expect(props.id).toBe("ac-1");
      expect(typeof props.opacity).toBe("number");
      expect(props.opacity).toBeGreaterThan(0);
      expect(props.opacity).toBeLessThanOrEqual(1);
    });

    it("produces lower opacity for older trails", () => {
      const store = createTrailStore();
      const now = 100000;

      // Fresh trail
      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], now - 5000);
      store.update([makeAircraft({ id: "ac-1", lng: 2, lat: 3 })], now);

      const geoFresh = store.toGeoJSON(now);
      const freshOpacity = geoFresh.features[0].properties!.opacity as number;

      // Query much later — trail is now old
      const geoOld = store.toGeoJSON(now + TRAIL_MAX_AGE_MS - 1000);
      const oldOpacity = geoOld.features[0].properties!.opacity as number;

      expect(oldOpacity).toBeLessThan(freshOpacity);
    });

    it("includes the aircraft id in feature properties", () => {
      const store = createTrailStore();

      store.update([makeAircraft({ id: "ac-42", lng: 1, lat: 2 })], 1000);
      store.update([makeAircraft({ id: "ac-42", lng: 3, lat: 4 })], 6000);

      const geo = store.toGeoJSON(6000);
      expect(geo.features[0].properties!.id).toBe("ac-42");
    });
  });

  describe("clear", () => {
    it("removes all stored trails", () => {
      const store = createTrailStore();

      store.update([makeAircraft({ id: "ac-1", lng: 1, lat: 2 })], 1000);
      store.update([makeAircraft({ id: "ac-1", lng: 2, lat: 3 })], 6000);

      store.clear();

      const geo = store.toGeoJSON(6000);
      expect(geo.features).toHaveLength(0);
    });
  });
});
