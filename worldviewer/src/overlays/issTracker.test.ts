import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ISS_ICON_LAYER_ID,
  ISS_SOURCE_ID,
  ISS_TRAIL_LAYER_ID,
  ISS_TRAIL_SOURCE_ID,
  ISS_UNAVAILABLE_NOTE,
  createIssTrackerOverlay,
  parseIssResponse,
  buildIssFeature,
  buildIssTrailFeature,
  formatIssStatus,
  type IssPosition
} from "./issTracker";
import { createMockMap } from "./test/createMockMap";

type SourceRecord = {
  type?: string;
  data?: GeoJSON.GeoJSON;
  setData: ReturnType<typeof vi.fn>;
};

function createIssMockMap() {
  return createMockMap({
    sourceFactory: (_id, source) => {
      const stored: Record<string, unknown> = {
        ...source,
        setData: vi.fn((data: GeoJSON.GeoJSON) => {
          stored.data = data;
        })
      };
      return stored;
    }
  });
}

function createJsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => payload)
  };
}

function makeSampleIssResponse(overrides?: Partial<IssPosition>) {
  return {
    name: "iss",
    id: 25544,
    latitude: overrides?.latitude ?? 51.5,
    longitude: overrides?.longitude ?? -0.12,
    altitude: overrides?.altitude ?? 408.5,
    velocity: overrides?.velocity ?? 27600.3,
    visibility: "daylight",
    footprint: 4542.79,
    timestamp: overrides?.timestamp ?? 1710590400,
    daynum: 2460387.5,
    solar_lat: -2.1,
    solar_lon: 45.3,
    units: "kilometers"
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("issTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("parseIssResponse", () => {
    it("parses a valid API response into a typed IssPosition", () => {
      const raw = makeSampleIssResponse();
      const result = parseIssResponse(raw);
      expect(result).toEqual({
        latitude: 51.5,
        longitude: -0.12,
        altitude: 408.5,
        velocity: 27600.3,
        timestamp: 1710590400
      });
    });

    it("returns null for non-object input", () => {
      expect(parseIssResponse(null)).toBeNull();
      expect(parseIssResponse(42)).toBeNull();
      expect(parseIssResponse("string")).toBeNull();
      expect(parseIssResponse(undefined)).toBeNull();
    });

    it("returns null when required fields are missing", () => {
      expect(parseIssResponse({ latitude: 10 })).toBeNull();
      expect(parseIssResponse({ latitude: 10, longitude: 20 })).toBeNull();
    });

    it("returns null when fields are non-finite", () => {
      const raw = makeSampleIssResponse();
      raw.latitude = NaN;
      expect(parseIssResponse(raw)).toBeNull();
    });

    it("returns null when fields are Infinity", () => {
      const raw = makeSampleIssResponse();
      raw.altitude = Infinity;
      expect(parseIssResponse(raw)).toBeNull();
    });
  });

  describe("buildIssFeature", () => {
    it("returns a Point with correct coordinates and properties", () => {
      const position: IssPosition = {
        latitude: 51.5,
        longitude: -0.12,
        altitude: 408.5,
        velocity: 27600.3,
        timestamp: 1710590400
      };

      const feature = buildIssFeature(position);
      expect(feature.type).toBe("Feature");
      expect(feature.geometry.type).toBe("Point");
      expect(feature.geometry.coordinates).toEqual([-0.12, 51.5]);
      expect(feature.properties).toEqual({
        altitude: 408.5,
        velocity: 27600.3,
        timestamp: 1710590400
      });
    });
  });

  describe("buildIssTrailFeature", () => {
    it("returns an empty MultiLineString for fewer than 2 positions", () => {
      const result = buildIssTrailFeature([]);
      expect(result.geometry.type).toBe("MultiLineString");
      expect(result.geometry.coordinates).toEqual([]);

      const single = buildIssTrailFeature([{
        latitude: 10, longitude: 20, altitude: 400, velocity: 27000, timestamp: 1
      }]);
      expect(single.geometry.coordinates).toEqual([]);
    });

    it("builds a single segment for continuous positions", () => {
      const trail: IssPosition[] = [
        { latitude: 10, longitude: 20, altitude: 400, velocity: 27000, timestamp: 1 },
        { latitude: 11, longitude: 21, altitude: 400, velocity: 27000, timestamp: 2 },
        { latitude: 12, longitude: 22, altitude: 400, velocity: 27000, timestamp: 3 }
      ];

      const result = buildIssTrailFeature(trail);
      expect(result.geometry.coordinates).toHaveLength(1);
      expect(result.geometry.coordinates[0]).toEqual([
        [20, 10], [21, 11], [22, 12]
      ]);
    });

    it("splits at the antimeridian crossing", () => {
      const trail: IssPosition[] = [
        { latitude: 10, longitude: 170, altitude: 400, velocity: 27000, timestamp: 1 },
        { latitude: 11, longitude: 175, altitude: 400, velocity: 27000, timestamp: 2 },
        { latitude: 12, longitude: -175, altitude: 400, velocity: 27000, timestamp: 3 },
        { latitude: 13, longitude: -170, altitude: 400, velocity: 27000, timestamp: 4 }
      ];

      const result = buildIssTrailFeature(trail);
      expect(result.geometry.coordinates).toHaveLength(2);
      expect(result.geometry.coordinates[0]).toEqual([
        [170, 10], [175, 11]
      ]);
      expect(result.geometry.coordinates[1]).toEqual([
        [-175, 12], [-170, 13]
      ]);
    });

    it("handles multiple antimeridian crossings", () => {
      const trail: IssPosition[] = [
        { latitude: 10, longitude: 170, altitude: 400, velocity: 27000, timestamp: 1 },
        { latitude: 11, longitude: -170, altitude: 400, velocity: 27000, timestamp: 2 },
        { latitude: 12, longitude: -160, altitude: 400, velocity: 27000, timestamp: 3 },
        { latitude: 13, longitude: 170, altitude: 400, velocity: 27000, timestamp: 4 },
        { latitude: 14, longitude: 175, altitude: 400, velocity: 27000, timestamp: 5 }
      ];

      const result = buildIssTrailFeature(trail);
      // Segment 1: [170,10] alone → too short, dropped
      // Segment 2: [-170,11], [-160,12] → 2 points
      // Segment 3: [170,13], [175,14] → 2 points
      expect(result.geometry.coordinates).toHaveLength(2);
    });
  });

  describe("formatIssStatus", () => {
    it("formats altitude and velocity", () => {
      const position: IssPosition = {
        latitude: 51.5,
        longitude: -0.12,
        altitude: 408.5,
        velocity: 27600.3,
        timestamp: 1710590400
      };

      const result = formatIssStatus(position);
      expect(result).toContain("ISS:");
      expect(result).toContain("409 km altitude");
      expect(result).toContain("km/h");
    });
  });

  describe("overlay lifecycle", () => {
    it("adds sources and layers on enable, removes on disable", async () => {
      const raw = makeSampleIssResponse();
      const fetchImpl = vi.fn(async () => createJsonResponse(raw));
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(map.addSource).toHaveBeenCalledWith(
        ISS_SOURCE_ID,
        expect.objectContaining({ type: "geojson" })
      );
      expect(map.addSource).toHaveBeenCalledWith(
        ISS_TRAIL_SOURCE_ID,
        expect.objectContaining({ type: "geojson" })
      );
      expect(map.addLayer).toHaveBeenCalledTimes(2);
      expect(map.getLayerAnchor(ISS_ICON_LAYER_ID)).toBe("label_city");
      expect(map.getLayerAnchor(ISS_TRAIL_LAYER_ID)).toBe("label_city");
      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ note: expect.stringContaining("ISS:") })
      );

      overlay.disable(map as never);

      expect(map.getSource(ISS_SOURCE_ID)).toBeUndefined();
      expect(map.getSource(ISS_TRAIL_SOURCE_ID)).toBeUndefined();
      expect(map.getLayer(ISS_ICON_LAYER_ID)).toBeUndefined();
      expect(map.getLayer(ISS_TRAIL_LAYER_ID)).toBeUndefined();
      expect(map.removeLayer).toHaveBeenCalledWith(ISS_ICON_LAYER_ID);
      expect(map.removeLayer).toHaveBeenCalledWith(ISS_TRAIL_LAYER_ID);
      expect(map.removeSource).toHaveBeenCalledWith(ISS_SOURCE_ID);
      expect(map.removeSource).toHaveBeenCalledWith(ISS_TRAIL_SOURCE_ID);
    });

    it("does not duplicate on repeated enable", async () => {
      const raw = makeSampleIssResponse();
      const fetchImpl = vi.fn(async () => createJsonResponse(raw));
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl });

      overlay.enable(map as never);
      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(map.addSource).toHaveBeenCalledTimes(2); // 2 sources (position + trail)
      expect(map.addLayer).toHaveBeenCalledTimes(2);  // 2 layers (icon + trail)
    });

    it("cancels pending load handler on disable before style load", async () => {
      const raw = makeSampleIssResponse();
      const fetchImpl = vi.fn(async () => createJsonResponse(raw));
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      map.styleLoaded = false;
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      overlay.disable(map as never);
      map.emitLoad();
      await flushAsyncWork();

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it("waits for style load before fetching", async () => {
      const raw = makeSampleIssResponse();
      const fetchImpl = vi.fn(async () => createJsonResponse(raw));
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      map.styleLoaded = false;
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).not.toHaveBeenCalled();

      map.emitLoad();
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(map.addSource).toHaveBeenCalled();
      expect(map.addLayer).toHaveBeenCalled();
    });

    it("reports unavailable on fetch failure", async () => {
      const fetchImpl = vi.fn(async () => createJsonResponse({}, 503));
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
      expect(onStateChange).toHaveBeenLastCalledWith({
        note: ISS_UNAVAILABLE_NOTE
      });
    });

    it("handles network error gracefully", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error("Network error");
      });
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(onStateChange).toHaveBeenLastCalledWith({
        note: ISS_UNAVAILABLE_NOTE
      });
    });

    it("reports unavailable on bad response data", async () => {
      const fetchImpl = vi.fn(async () => createJsonResponse({ bad: "data" }));
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(onStateChange).toHaveBeenLastCalledWith({
        note: ISS_UNAVAILABLE_NOTE
      });
    });

    it("trail accumulates positions across refreshes", async () => {
      const responses = [
        createJsonResponse(makeSampleIssResponse({ latitude: 10, longitude: 20 })),
        createJsonResponse(makeSampleIssResponse({ latitude: 11, longitude: 21 })),
        createJsonResponse(makeSampleIssResponse({ latitude: 12, longitude: 22 }))
      ];
      const fetchImpl = vi.fn(async () => responses.shift()!);
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({
        fetchImpl,
        pollIntervalMs: 10
      });

      overlay.enable(map as never);
      await flushAsyncWork();

      // First fetch: trail has 1 position
      const trailSource1 = map.getSource(ISS_TRAIL_SOURCE_ID) as SourceRecord;
      const data1 = trailSource1.data as GeoJSON.FeatureCollection;
      const geom1 = (data1.features[0].geometry as GeoJSON.MultiLineString);
      // Only 1 position → empty MultiLineString
      expect(geom1.coordinates).toEqual([]);

      // Second fetch
      await vi.advanceTimersByTimeAsync(10);
      await flushAsyncWork();

      const data2 = trailSource1.data as GeoJSON.FeatureCollection;
      const geom2 = (data2.features[0].geometry as GeoJSON.MultiLineString);
      expect(geom2.coordinates).toHaveLength(1);
      expect(geom2.coordinates[0]).toHaveLength(2);

      // Third fetch
      await vi.advanceTimersByTimeAsync(10);
      await flushAsyncWork();

      const data3 = trailSource1.data as GeoJSON.FeatureCollection;
      const geom3 = (data3.features[0].geometry as GeoJSON.MultiLineString);
      expect(geom3.coordinates).toHaveLength(1);
      expect(geom3.coordinates[0]).toHaveLength(3);
    });

    it("timer fires refresh", async () => {
      const responses = [
        createJsonResponse(makeSampleIssResponse({ altitude: 408 })),
        createJsonResponse(makeSampleIssResponse({ altitude: 410 }))
      ];
      const fetchImpl = vi.fn(async () => responses.shift()!);
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({
        fetchImpl,
        pollIntervalMs: 10,
        onStateChange
      });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      // Source was updated via setData, not re-added
      const source = map.getSource(ISS_SOURCE_ID) as SourceRecord;
      expect(source.setData).toHaveBeenCalled();
      expect(map.addSource).toHaveBeenCalledTimes(2); // 2 sources initially
    });

    it("clears timer on disable so no further refreshes occur", async () => {
      const fetchImpl = vi.fn(async () =>
        createJsonResponse(makeSampleIssResponse())
      );
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({
        fetchImpl,
        pollIntervalMs: 60_000
      });

      overlay.enable(map as never);
      await flushAsyncWork();
      const callsAfterEnable = fetchImpl.mock.calls.length;

      overlay.disable(map as never);

      vi.advanceTimersByTime(60_000);
      await flushAsyncWork();

      expect(fetchImpl.mock.calls.length).toBe(callsAfterEnable);
    });

    it("ignores stale async completions after disable while fetching", async () => {
      let resolveResponse: ((response: ReturnType<typeof createJsonResponse>) => void) | null = null;
      const fetchImpl = vi.fn(
        () =>
          new Promise<ReturnType<typeof createJsonResponse>>((resolve) => {
            resolveResponse = resolve;
          })
      );
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      overlay.disable(map as never);
      resolveResponse!(createJsonResponse(makeSampleIssResponse()));
      await flushAsyncWork();

      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it("silently returns when fetch is aborted during refresh", async () => {
      let rejectFetch: (reason: unknown) => void;
      const fetchImpl = vi.fn(
        () =>
          new Promise<ReturnType<typeof createJsonResponse>>((_resolve, reject) => {
            rejectFetch = reject;
          })
      );
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      const abortError = new DOMException("The operation was aborted.", "AbortError");
      rejectFetch!(abortError);
      await flushAsyncWork();

      const lastCall = onStateChange.mock.calls.at(-1);
      expect(lastCall?.[0]?.note).not.toBe(ISS_UNAVAILABLE_NOTE);
    });

    it("publishes inactive presentation on disable", async () => {
      const fetchImpl = vi.fn(async () =>
        createJsonResponse(makeSampleIssResponse())
      );
      const onStateChange = vi.fn();
      const map = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      overlay.disable(map as never);

      expect(onStateChange).toHaveBeenLastCalledWith({ note: null });
    });

    it("removes overlay from old map when enabling on a different map", async () => {
      const fetchImpl = vi.fn(async () =>
        createJsonResponse(makeSampleIssResponse())
      );
      const map1 = createIssMockMap();
      const map2 = createIssMockMap();
      const overlay = createIssTrackerOverlay({ fetchImpl });

      overlay.enable(map1 as never);
      await flushAsyncWork();

      expect(map1.getSource(ISS_SOURCE_ID)).toBeTruthy();

      overlay.enable(map2 as never);
      await flushAsyncWork();

      expect(map1.getSource(ISS_SOURCE_ID)).toBeUndefined();
      expect(map1.getLayer(ISS_ICON_LAYER_ID)).toBeUndefined();
      expect(map2.getSource(ISS_SOURCE_ID)).toBeTruthy();
    });
  });
});
