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

type LoadListener = () => void;

type SourceRecord = {
  attribution?: string;
  maxzoom?: number;
  setTiles: ReturnType<typeof vi.fn>;
  tileSize?: number;
  tiles?: string[];
  type?: string;
};

class MockMap {
  styleLoaded = true;
  readonly addSource = vi.fn((id: string, source: SourceRecord) => {
    const storedSource: SourceRecord = {
      ...source,
      setTiles: vi.fn((tiles: string[]) => {
        storedSource.tiles = tiles;
      })
    };
    this.sources.set(id, storedSource);
  });
  readonly getSource = vi.fn((id: string) => this.sources.get(id));
  readonly addLayer = vi.fn((layer: { id: string }, beforeId?: string) => {
    this.layers.set(layer.id, layer);
    this.layerAnchors.set(layer.id, beforeId);
  });
  readonly getLayer = vi.fn((id: string) => this.layers.get(id));
  readonly removeLayer = vi.fn((id: string) => {
    this.layers.delete(id);
    this.layerAnchors.delete(id);
  });
  readonly removeSource = vi.fn((id: string) => {
    this.sources.delete(id);
  });
  readonly isStyleLoaded = vi.fn(() => this.styleLoaded);
  readonly on = vi.fn((event: string, listener: LoadListener) => {
    if (event === "load") {
      this.loadListeners.add(listener);
    }
  });
  readonly off = vi.fn((event: string, listener: LoadListener) => {
    if (event === "load") {
      this.loadListeners.delete(listener);
    }
  });
  readonly getStyle = vi.fn(() => ({
    layers: [
      { id: "background", type: "background" },
      { id: "satellite-imagery", type: "raster", source: "satellite" },
      { id: "road_minor", type: "line" },
      { id: "label_city", type: "symbol", layout: { "text-field": ["get", "name"] } }
    ]
  }));

  private readonly sources = new Map<string, SourceRecord>();
  private readonly layers = new Map<string, unknown>();
  private readonly layerAnchors = new Map<string, string | undefined>();
  private readonly loadListeners = new Set<LoadListener>();

  emitLoad(): void {
    this.styleLoaded = true;
    for (const listener of [...this.loadListeners]) {
      listener();
    }
  }

  getLayerAnchor(id: string): string | undefined {
    return this.layerAnchors.get(id);
  }
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
    const map = new MockMap();
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
    const map = new MockMap();
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
    const map = new MockMap();
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
    const map = new MockMap();
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
    const map = new MockMap();
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
    const map = new MockMap();
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
    const map = new MockMap();
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
    const map = new MockMap();
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
    const map = new MockMap();
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
});
