import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WEATHER_RADAR_CREDIT_LABEL,
  WEATHER_RADAR_LAYER_ID,
  WEATHER_RADAR_SOURCE_ID,
  buildWeatherRadarTileUrl,
  createWeatherRadarOverlay,
  formatWeatherRadarStatus,
  parseLatestWeatherRadarFrame
} from "./weatherRadar";
import { createMockMap } from "./test/createMockMap";

type SourceRecord = {
  attribution?: string;
  maxzoom?: number;
  setTiles: ReturnType<typeof vi.fn>;
  tileSize?: number;
  tiles?: string[];
  type?: string;
};

function createWeatherMockMap() {
  return createMockMap({
    sourceFactory: (_id, source) => {
      const stored: Record<string, unknown> = {
        ...source,
        setTiles: vi.fn((tiles: string[]) => {
          stored.tiles = tiles;
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

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("weatherRadar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses the newest valid past frame and builds the RainViewer tile URL", () => {
    const frame = parseLatestWeatherRadarFrame({
      host: "https://tilecache.rainviewer.com/",
      radar: {
        past: [
          { time: 1_763_000_000, path: "v2/radar/1" },
          { time: 1_763_000_600, path: "/v2/radar/2" },
          { time: 1_763_000_700, path: "" }
        ]
      }
    });

    expect(frame).toEqual({
      host: "https://tilecache.rainviewer.com",
      path: "/v2/radar/2",
      time: 1_763_000_600
    });
    expect(buildWeatherRadarTileUrl(frame!.host, frame!.path)).toBe(
      "https://tilecache.rainviewer.com/v2/radar/2/512/{z}/{x}/{y}/2/1_0.png"
    );
  });

  it("formats a fixed UTC radar status line", () => {
    const timeSeconds = Date.UTC(2026, 0, 1, 12, 10, 0) / 1_000;

    expect(formatWeatherRadarStatus(timeSeconds)).toBe("Radar frame 12:10 UTC - RainViewer");
  });

  it("returns null for non-object metadata", () => {
    expect(parseLatestWeatherRadarFrame(null)).toBeNull();
    expect(parseLatestWeatherRadarFrame(42)).toBeNull();
    expect(parseLatestWeatherRadarFrame("string")).toBeNull();
  });

  it("skips non-object candidates in past frames", () => {
    const frame = parseLatestWeatherRadarFrame({
      host: "https://tilecache.rainviewer.com",
      radar: {
        past: [
          42,
          "string",
          null,
          { time: 1_763_000_000, path: "/v2/radar/1" }
        ]
      }
    });
    expect(frame).toEqual({
      host: "https://tilecache.rainviewer.com",
      path: "/v2/radar/1",
      time: 1_763_000_000
    });
  });

  it("treats missing host or usable past frames as unavailable metadata", () => {
    expect(
      parseLatestWeatherRadarFrame({
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    ).toBeNull();
    expect(
      parseLatestWeatherRadarFrame({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000 }]
        }
      })
    ).toBeNull();
    expect(
      parseLatestWeatherRadarFrame({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: []
        }
      })
    ).toBeNull();
  });

  it("adds the raster source once and updates later frames through setTiles", async () => {
    const responses = [
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      }),
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_600, path: "/v2/radar/2" }]
        }
      })
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      updateIntervalMs: 5,
      onStateChange
    });

    overlay.enable(map as never);
    await flushAsyncWork();

    const source = map.getSource(WEATHER_RADAR_SOURCE_ID) as SourceRecord;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map.getLayerAnchor(WEATHER_RADAR_LAYER_ID)).toBe("road_minor");
    expect(map.addSource).toHaveBeenCalledWith(
      WEATHER_RADAR_SOURCE_ID,
      expect.objectContaining({
        type: "raster",
        tileSize: 512,
        maxzoom: 7,
        attribution: expect.stringContaining("https://www.rainviewer.com/")
      })
    );
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: formatWeatherRadarStatus(1_763_000_000),
      creditLabel: WEATHER_RADAR_CREDIT_LABEL
    });

    await vi.advanceTimersByTimeAsync(5);
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(source.setTiles).toHaveBeenCalledWith([
      buildWeatherRadarTileUrl("https://tilecache.rainviewer.com", "/v2/radar/2")
    ]);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: formatWeatherRadarStatus(1_763_000_600),
      creditLabel: WEATHER_RADAR_CREDIT_LABEL
    });
  });

  it("hides the overlay and reports unavailable when refreshed metadata is malformed", async () => {
    const responses = [
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      }),
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_600 }]
        }
      })
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      updateIntervalMs: 5,
      onStateChange
    });

    overlay.enable(map as never);
    await flushAsyncWork();

    expect(map.getSource(WEATHER_RADAR_SOURCE_ID)).toBeTruthy();
    expect(map.getLayer(WEATHER_RADAR_LAYER_ID)).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5);
    await flushAsyncWork();

    expect(map.getSource(WEATHER_RADAR_SOURCE_ID)).toBeUndefined();
    expect(map.getLayer(WEATHER_RADAR_LAYER_ID)).toBeUndefined();
    expect(map.removeLayer).toHaveBeenCalledWith(WEATHER_RADAR_LAYER_ID);
    expect(map.removeSource).toHaveBeenCalledWith(WEATHER_RADAR_SOURCE_ID);
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: "Radar unavailable",
      creditLabel: null
    });
  });

  it("reports unavailable when the metadata request fails", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({}, 503));
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      onStateChange
    });

    overlay.enable(map as never);
    await flushAsyncWork();

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: "Radar unavailable",
      creditLabel: null
    });
  });

  it("waits for the first style load before fetching and adding the overlay", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    );
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    map.styleLoaded = false;
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      onStateChange
    });

    overlay.enable(map as never);
    await flushAsyncWork();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();

    map.emitLoad();
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: formatWeatherRadarStatus(1_763_000_000),
      creditLabel: WEATHER_RADAR_CREDIT_LABEL
    });
  });

  it("cancels the pending load path when disabled before style load", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    );
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    map.styleLoaded = false;
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      onStateChange
    });

    overlay.enable(map as never);
    overlay.disable(map as never);
    map.emitLoad();
    await flushAsyncWork();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
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
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      onStateChange
    });

    overlay.enable(map as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    overlay.disable(map as never);
    expect(resolveResponse).toBeTypeOf("function");
    resolveResponse!(
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    );
    await flushAsyncWork();

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("ignores stale same-session refresh completions that resolve out of order", async () => {
    const resolveResponses: Array<(response: ReturnType<typeof createJsonResponse>) => void> = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<ReturnType<typeof createJsonResponse>>((resolve) => {
          resolveResponses.push(resolve);
        })
    );
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      updateIntervalMs: 5,
      onStateChange
    });

    overlay.enable(map as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    resolveResponses[1]!(
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_600, path: "/v2/radar/2" }]
        }
      })
    );
    await flushAsyncWork();

    const source = map.getSource(WEATHER_RADAR_SOURCE_ID) as SourceRecord;
    expect(source.tiles).toEqual([
      buildWeatherRadarTileUrl("https://tilecache.rainviewer.com", "/v2/radar/2")
    ]);
    expect(source.setTiles).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: formatWeatherRadarStatus(1_763_000_600),
      creditLabel: WEATHER_RADAR_CREDIT_LABEL
    });

    resolveResponses[0]!(
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    );
    await flushAsyncWork();

    expect(source.tiles).toEqual([
      buildWeatherRadarTileUrl("https://tilecache.rainviewer.com", "/v2/radar/2")
    ]);
    expect(source.setTiles).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: formatWeatherRadarStatus(1_763_000_600),
      creditLabel: WEATHER_RADAR_CREDIT_LABEL
    });
  });

  it("reasserts the overlay on repeated enable when the same map loses style state", async () => {
    let fetchCount = 0;
    let resolveRefresh:
      | ((response: ReturnType<typeof createJsonResponse>) => void)
      | null = null;
    const fetchImpl = vi.fn(() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve(
          createJsonResponse({
            host: "https://tilecache.rainviewer.com",
            radar: {
              past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
            }
          })
        );
      }

      return new Promise<ReturnType<typeof createJsonResponse>>((resolve) => {
        resolveRefresh = resolve;
      });
    });
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      onStateChange
    });

    overlay.enable(map as never);
    await flushAsyncWork();

    map.removeLayer(WEATHER_RADAR_LAYER_ID);
    map.removeSource(WEATHER_RADAR_SOURCE_ID);
    expect(map.getLayer(WEATHER_RADAR_LAYER_ID)).toBeUndefined();
    expect(map.getSource(WEATHER_RADAR_SOURCE_ID)).toBeUndefined();

    overlay.enable(map as never);

    const source = map.getSource(WEATHER_RADAR_SOURCE_ID) as SourceRecord;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    expect(source.tiles).toEqual([
      buildWeatherRadarTileUrl("https://tilecache.rainviewer.com", "/v2/radar/1")
    ]);
    expect(map.getLayer(WEATHER_RADAR_LAYER_ID)).toBeTruthy();
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: formatWeatherRadarStatus(1_763_000_000),
      creditLabel: WEATHER_RADAR_CREDIT_LABEL
    });

    expect(resolveRefresh).toBeTypeOf("function");
    resolveRefresh!(
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_600, path: "/v2/radar/2" }]
        }
      })
    );
    await flushAsyncWork();

    expect(source.setTiles).toHaveBeenCalledWith([
      buildWeatherRadarTileUrl("https://tilecache.rainviewer.com", "/v2/radar/2")
    ]);
    expect(onStateChange).toHaveBeenLastCalledWith({
      note: formatWeatherRadarStatus(1_763_000_600),
      creditLabel: WEATHER_RADAR_CREDIT_LABEL
    });
  });

  it("does not duplicate fetches or layers on repeated enable calls for the same map", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    );
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl
    });

    overlay.enable(map as never);
    overlay.enable(map as never);
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it("does not re-emit onStateChange when publish is called with the same presentation", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    );
    const onStateChange = vi.fn();
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      updateIntervalMs: 5,
      onStateChange
    });

    overlay.enable(map as never);
    await flushAsyncWork();

    const callCount = onStateChange.mock.calls.length;

    // Second refresh returns the exact same frame — publish should deduplicate
    await vi.advanceTimersByTimeAsync(5);
    await flushAsyncWork();

    expect(onStateChange).toHaveBeenCalledTimes(callCount);
  });

  it("clears currentTileUrl when removeOverlay is called on stale response", async () => {
    const responses = [
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      }),
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: { past: [] }
      })
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      updateIntervalMs: 5
    });

    overlay.enable(map as never);
    await flushAsyncWork();

    expect(map.getSource(WEATHER_RADAR_SOURCE_ID)).toBeTruthy();

    // Second refresh returns empty frames → triggers removeOverlay
    await vi.advanceTimersByTimeAsync(5);
    await flushAsyncWork();

    expect(map.getSource(WEATHER_RADAR_SOURCE_ID)).toBeUndefined();
    expect(map.getLayer(WEATHER_RADAR_LAYER_ID)).toBeUndefined();
  });

  it("removes overlay from old map when enabling on a different map", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    );
    const map1 = createWeatherMockMap();
    const map2 = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({ fetchImpl });

    overlay.enable(map1 as never);
    await flushAsyncWork();

    expect(map1.getSource(WEATHER_RADAR_SOURCE_ID)).toBeTruthy();

    // Enabling on a different map should clean up the old map
    overlay.enable(map2 as never);
    await flushAsyncWork();

    expect(map1.getSource(WEATHER_RADAR_SOURCE_ID)).toBeUndefined();
    expect(map1.getLayer(WEATHER_RADAR_LAYER_ID)).toBeUndefined();
    expect(map2.getSource(WEATHER_RADAR_SOURCE_ID)).toBeTruthy();
  });

  it("prepends a leading slash to RainViewer paths that lack one", () => {
    const tileUrl = buildWeatherRadarTileUrl(
      "https://tilecache.rainviewer.com",
      "v2/radar/1"
    );

    expect(tileUrl).toBe(
      "https://tilecache.rainviewer.com/v2/radar/1/512/{z}/{x}/{y}/2/1_0.png"
    );
  });

  it("treats whitespace-only host as unavailable metadata", () => {
    expect(
      parseLatestWeatherRadarFrame({
        host: "   ",
        radar: {
          past: [{ time: 1_763_000_000, path: "/v2/radar/1" }]
        }
      })
    ).toBeNull();
  });

  it("throws when buildWeatherRadarTileUrl receives an empty host", () => {
    expect(() => buildWeatherRadarTileUrl("  ", "/v2/radar/1")).toThrow();
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
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({ fetchImpl, onStateChange });

    overlay.enable(map as never);
    await flushAsyncWork();

    // Simulate an abort error
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    rejectFetch!(abortError);
    await flushAsyncWork();

    // Should not publish unavailable presentation on abort
    const lastCall = onStateChange.mock.calls.at(-1);
    expect(lastCall?.[0]?.note).not.toBe("Radar unavailable");
  });

  it("ignores a stale timer tick after disable", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: { past: [{ time: 1_763_000_000, path: "/v2/radar/1" }] }
      })
    );
    const map = createWeatherMockMap();
    const overlay = createWeatherRadarOverlay({
      fetchImpl,
      updateIntervalMs: 60_000
    });

    overlay.enable(map as never);
    await flushAsyncWork();
    const callsAfterEnable = fetchImpl.mock.calls.length;

    overlay.disable(map as never);

    // Advance past the refresh interval - timer should be cleared
    vi.advanceTimersByTime(60_000);
    await flushAsyncWork();

    expect(fetchImpl.mock.calls.length).toBe(callsAfterEnable);
  });

  it("ignores stale apply callback when overlay is disabled before style loads", async () => {
    const fetchImpl = vi.fn(async () =>
      createJsonResponse({
        host: "https://tilecache.rainviewer.com",
        radar: { past: [{ time: 1_763_000_000, path: "/v2/radar/1" }] }
      })
    );

    const map = createWeatherMockMap();
    map.styleLoaded = false;

    const overlay = createWeatherRadarOverlay({ fetchImpl });

    overlay.enable(map as never);

    // Disable before the load event fires
    overlay.disable(map as never);

    // Now simulate the load event firing
    map.emitLoad();
    await flushAsyncWork();

    // The stale load handler should not trigger a fetch
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
