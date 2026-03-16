import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EARTHQUAKE_CREDIT_LABEL,
  EARTHQUAKE_LAYER_ID,
  EARTHQUAKE_SOURCE_ID,
  EARTHQUAKE_UNAVAILABLE_NOTE,
  createEarthquakeOverlay,
  formatAge,
  formatEarthquakePopup,
  formatEarthquakeStatus,
  normalizeEarthquakeFeatures
} from "./earthquakeOverlay";
import { createMockMap } from "./test/createMockMap";

type SourceRecord = {
  type?: string;
  data?: GeoJSON.GeoJSON;
  setData: ReturnType<typeof vi.fn>;
};

function createEarthquakeMockMap() {
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

function makeSampleFeatureCollection(count = 3): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < count; i++) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [-120 + i, 37 + i, 10 + i]
      },
      properties: {
        mag: 3.0 + i,
        place: `${10 + i}km NW of TestCity${i}`,
        time: Date.now() - i * 3_600_000
      }
    });
  }
  return { type: "FeatureCollection", features };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("earthquakeOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("normalizeEarthquakeFeatures", () => {
    it("passes through a valid FeatureCollection with depth added to properties", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-120, 37, 12.5] },
            properties: { mag: 4.2, place: "10km NW of City", time: 1000000 }
          }
        ]
      };

      const result = normalizeEarthquakeFeatures(input);
      expect(result.type).toBe("FeatureCollection");
      expect(result.features).toHaveLength(1);
      expect(result.features[0].properties).toEqual({
        mag: 4.2,
        place: "10km NW of City",
        time: 1000000,
        depth: 12.5
      });
    });

    it("defaults depth to 0 when coordinates lack a third element", () => {
      const input: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-120, 37] },
            properties: { mag: 3.0 }
          }
        ]
      };

      const result = normalizeEarthquakeFeatures(input);
      expect(result.features[0].properties!.depth).toBe(0);
    });

    it("returns empty FeatureCollection for non-object input", () => {
      expect(normalizeEarthquakeFeatures(null).features).toEqual([]);
      expect(normalizeEarthquakeFeatures(42).features).toEqual([]);
      expect(normalizeEarthquakeFeatures("string").features).toEqual([]);
    });

    it("returns empty FeatureCollection when type is not FeatureCollection", () => {
      const result = normalizeEarthquakeFeatures({ type: "Feature", geometry: null, properties: null });
      expect(result.features).toEqual([]);
    });

    it("skips non-Point features", () => {
      const input = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
            properties: {}
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [10, 20, 5] },
            properties: { mag: 2.5 }
          }
        ]
      };

      const result = normalizeEarthquakeFeatures(input);
      expect(result.features).toHaveLength(1);
      expect(result.features[0].properties!.mag).toBe(2.5);
    });
  });

  describe("formatEarthquakePopup", () => {
    it("produces expected HTML with escaped text", () => {
      vi.setSystemTime(new Date("2026-03-16T12:00:00Z"));
      const html = formatEarthquakePopup({
        mag: 5.2,
        place: '10km NW of "TestCity"',
        time: Date.now() - 7_200_000,
        depth: 10
      });

      expect(html).toContain("Earthquake");
      expect(html).toContain("M5.2");
      expect(html).toContain("10km NW of &quot;TestCity&quot;");
      expect(html).toContain("10 km deep");
      expect(html).toContain("2h ago");
    });

    it("handles missing/invalid properties gracefully", () => {
      const html = formatEarthquakePopup({
        mag: NaN,
        place: "",
        time: 0,
        depth: NaN
      });

      expect(html).toContain("M?");
      expect(html).toContain("Unknown location");
      expect(html).toContain("Unknown depth");
      expect(html).toContain("Unknown time");
    });
  });

  describe("formatAge", () => {
    it("formats recent timestamps", () => {
      vi.setSystemTime(new Date("2026-03-16T12:00:00Z"));
      const now = Date.now();

      expect(formatAge(now)).toBe("just now");
      expect(formatAge(now - 30_000)).toBe("just now");
      expect(formatAge(now - 60_000)).toBe("1m ago");
      expect(formatAge(now - 300_000)).toBe("5m ago");
      expect(formatAge(now - 3_600_000)).toBe("1h ago");
      expect(formatAge(now - 7_200_000)).toBe("2h ago");
      expect(formatAge(now - 86_400_000)).toBe("1d ago");
    });

    it("handles future timestamps", () => {
      vi.setSystemTime(new Date("2026-03-16T12:00:00Z"));
      expect(formatAge(Date.now() + 60_000)).toBe("just now");
    });
  });

  describe("formatEarthquakeStatus", () => {
    it("pluralizes correctly", () => {
      expect(formatEarthquakeStatus(0)).toBe("0 earthquakes M2.5+ today - USGS");
      expect(formatEarthquakeStatus(1)).toBe("1 earthquake M2.5+ today - USGS");
      expect(formatEarthquakeStatus(42)).toBe("42 earthquakes M2.5+ today - USGS");
    });
  });

  describe("overlay lifecycle", () => {
    it("adds source and layer on enable, removes on disable", async () => {
      const fc = makeSampleFeatureCollection();
      const fetchImpl = vi.fn(async () => createJsonResponse(fc));
      const onStateChange = vi.fn();
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({
        fetchImpl,
        onStateChange
      });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(map.addSource).toHaveBeenCalledTimes(1);
      expect(map.addLayer).toHaveBeenCalledTimes(1);
      expect(map.addSource).toHaveBeenCalledWith(
        EARTHQUAKE_SOURCE_ID,
        expect.objectContaining({ type: "geojson" })
      );
      expect(map.getLayerAnchor(EARTHQUAKE_LAYER_ID)).toBe("label_city");
      expect(onStateChange).toHaveBeenLastCalledWith({
        note: formatEarthquakeStatus(3),
        creditLabel: EARTHQUAKE_CREDIT_LABEL
      });

      overlay.disable(map as never);

      expect(map.getSource(EARTHQUAKE_SOURCE_ID)).toBeUndefined();
      expect(map.getLayer(EARTHQUAKE_LAYER_ID)).toBeUndefined();
      expect(map.removeLayer).toHaveBeenCalledWith(EARTHQUAKE_LAYER_ID);
      expect(map.removeSource).toHaveBeenCalledWith(EARTHQUAKE_SOURCE_ID);
    });

    it("does not duplicate on repeated enable", async () => {
      const fc = makeSampleFeatureCollection();
      const fetchImpl = vi.fn(async () => createJsonResponse(fc));
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({ fetchImpl });

      overlay.enable(map as never);
      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(map.addSource).toHaveBeenCalledTimes(1);
      expect(map.addLayer).toHaveBeenCalledTimes(1);
    });

    it("cancels pending load handler on disable before style load", async () => {
      const fc = makeSampleFeatureCollection();
      const fetchImpl = vi.fn(async () => createJsonResponse(fc));
      const onStateChange = vi.fn();
      const map = createEarthquakeMockMap();
      map.styleLoaded = false;
      const overlay = createEarthquakeOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      overlay.disable(map as never);
      map.emitLoad();
      await flushAsyncWork();

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it("waits for style load before fetching and adding overlay", async () => {
      const fc = makeSampleFeatureCollection();
      const fetchImpl = vi.fn(async () => createJsonResponse(fc));
      const onStateChange = vi.fn();
      const map = createEarthquakeMockMap();
      map.styleLoaded = false;
      const overlay = createEarthquakeOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(map.addSource).not.toHaveBeenCalled();

      map.emitLoad();
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(map.addSource).toHaveBeenCalledTimes(1);
      expect(map.addLayer).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenLastCalledWith({
        note: formatEarthquakeStatus(3),
        creditLabel: EARTHQUAKE_CREDIT_LABEL
      });
    });

    it("timer fires refresh", async () => {
      const responses = [
        createJsonResponse(makeSampleFeatureCollection(2)),
        createJsonResponse(makeSampleFeatureCollection(5))
      ];
      const fetchImpl = vi.fn(async () => responses.shift()!);
      const onStateChange = vi.fn();
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({
        fetchImpl,
        updateIntervalMs: 10,
        onStateChange
      });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenLastCalledWith({
        note: formatEarthquakeStatus(2),
        creditLabel: EARTHQUAKE_CREDIT_LABEL
      });

      await vi.advanceTimersByTimeAsync(10);
      await flushAsyncWork();

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      // Source was updated via setData, not re-added
      const source = map.getSource(EARTHQUAKE_SOURCE_ID) as SourceRecord;
      expect(source.setData).toHaveBeenCalled();
      expect(map.addSource).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenLastCalledWith({
        note: formatEarthquakeStatus(5),
        creditLabel: EARTHQUAKE_CREDIT_LABEL
      });
    });

    it("reports unavailable on fetch failure", async () => {
      const fetchImpl = vi.fn(async () => createJsonResponse({}, 503));
      const onStateChange = vi.fn();
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
      expect(onStateChange).toHaveBeenLastCalledWith({
        note: EARTHQUAKE_UNAVAILABLE_NOTE,
        creditLabel: null
      });
    });

    it("reports unavailable when response contains no features", async () => {
      const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      const fetchImpl = vi.fn(async () => createJsonResponse(fc));
      const onStateChange = vi.fn();
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      expect(onStateChange).toHaveBeenLastCalledWith({
        note: EARTHQUAKE_UNAVAILABLE_NOTE,
        creditLabel: null
      });
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
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      overlay.disable(map as never);
      resolveResponse!(createJsonResponse(makeSampleFeatureCollection()));
      await flushAsyncWork();

      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it("clears timer on disable so no further refreshes occur", async () => {
      const fetchImpl = vi.fn(async () =>
        createJsonResponse(makeSampleFeatureCollection())
      );
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({
        fetchImpl,
        updateIntervalMs: 60_000
      });

      overlay.enable(map as never);
      await flushAsyncWork();
      const callsAfterEnable = fetchImpl.mock.calls.length;

      overlay.disable(map as never);

      vi.advanceTimersByTime(60_000);
      await flushAsyncWork();

      expect(fetchImpl.mock.calls.length).toBe(callsAfterEnable);
    });

    it("removes overlay from old map when enabling on a different map", async () => {
      const fetchImpl = vi.fn(async () =>
        createJsonResponse(makeSampleFeatureCollection())
      );
      const map1 = createEarthquakeMockMap();
      const map2 = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({ fetchImpl });

      overlay.enable(map1 as never);
      await flushAsyncWork();

      expect(map1.getSource(EARTHQUAKE_SOURCE_ID)).toBeTruthy();

      overlay.enable(map2 as never);
      await flushAsyncWork();

      expect(map1.getSource(EARTHQUAKE_SOURCE_ID)).toBeUndefined();
      expect(map1.getLayer(EARTHQUAKE_LAYER_ID)).toBeUndefined();
      expect(map2.getSource(EARTHQUAKE_SOURCE_ID)).toBeTruthy();
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
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      const abortError = new DOMException("The operation was aborted.", "AbortError");
      rejectFetch!(abortError);
      await flushAsyncWork();

      const lastCall = onStateChange.mock.calls.at(-1);
      expect(lastCall?.[0]?.note).not.toBe(EARTHQUAKE_UNAVAILABLE_NOTE);
    });

    it("publishes inactive presentation on disable", async () => {
      const fetchImpl = vi.fn(async () =>
        createJsonResponse(makeSampleFeatureCollection())
      );
      const onStateChange = vi.fn();
      const map = createEarthquakeMockMap();
      const overlay = createEarthquakeOverlay({ fetchImpl, onStateChange });

      overlay.enable(map as never);
      await flushAsyncWork();

      overlay.disable(map as never);

      expect(onStateChange).toHaveBeenLastCalledWith({
        note: null,
        creditLabel: null
      });
    });
  });
});
