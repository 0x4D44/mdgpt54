import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPollingOverlay, type PollingOverlayConfig } from "./createPollingOverlay";
import { createMockMap } from "./test/createMockMap";

type Presentation = { note: string | null };

const INACTIVE: Presentation = { note: null };
const UNAVAILABLE: Presentation = { note: "unavailable" };

const SOURCE_ID = "fake-source";
const LAYER_ID = "fake-layer";
const URL = "https://example.test/data.json";

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

/**
 * Build a minimal-but-real config. `parse` returns the raw value as TParsed
 * unless it is null (which the factory must treat as UNAVAILABLE).
 */
function makeConfig(
  overrides: Partial<PollingOverlayConfig<{ value: number }, Presentation>> = {}
): PollingOverlayConfig<{ value: number }, Presentation> {
  const fetchImpl =
    overrides.fetchImpl ??
    vi.fn(async () => createJsonResponse({ value: 1 }));

  return {
    url: URL,
    fetchImpl,
    refreshIntervalMs: 10,
    requestErrorMessage: (status) => `failed ${status}`,
    parse: (raw) =>
      raw && typeof raw === "object" && "value" in raw
        ? (raw as { value: number })
        : null,
    syncSourceAndLayer: ({ map }) => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: "geojson" } as never);
      }
      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({ id: LAYER_ID } as never);
      }
    },
    removeOverlay: (map) => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    },
    presentation: {
      inactive: INACTIVE,
      unavailable: UNAVAILABLE,
      active: (parsed) => ({ note: `value ${parsed.value}` }),
      equals: (a, b) => a.note === b.note,
      onStateChange: vi.fn()
    },
    ...overrides
  };
}

describe("createPollingOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("(a) waits for style load before fetching, then refreshes", async () => {
    const config = makeConfig();
    const map = createMockMap();
    map.styleLoaded = false;
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    await flushAsyncWork();

    expect(config.fetchImpl).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();

    map.emitLoad();
    await flushAsyncWork();

    expect(config.fetchImpl).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(config.presentation.onStateChange).toHaveBeenLastCalledWith({ note: "value 1" });
  });

  it("(b) disable cancels load handler, timer, in-flight fetch and publishes inactive", async () => {
    let resolveResponse: ((response: ReturnType<typeof createJsonResponse>) => void) | null = null;
    const fetchImpl = vi.fn(
      () =>
        new Promise<ReturnType<typeof createJsonResponse>>((resolve) => {
          resolveResponse = resolve;
        })
    );
    const config = makeConfig({ fetchImpl });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    // Drive one successful refresh so a presentation other than inactive exists.
    overlay.enable(map as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    overlay.disable(map as never);

    // The in-flight fetch resolves after disable; must be ignored.
    resolveResponse!(createJsonResponse({ value: 9 }));
    await flushAsyncWork();

    // Timer must not fire any further fetch.
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // disable publishes inactive (and only inactive — first publish on enable deduped).
    expect(config.presentation.onStateChange).not.toHaveBeenCalled();
  });

  it("(c) drops a slow refresh that resolves after a newer one (double-token)", async () => {
    const resolvers: Array<(response: ReturnType<typeof createJsonResponse>) => void> = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<ReturnType<typeof createJsonResponse>>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const config = makeConfig({ fetchImpl });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Newer (second) refresh resolves first.
    resolvers[1]!(createJsonResponse({ value: 2 }));
    await flushAsyncWork();
    expect(config.presentation.onStateChange).toHaveBeenLastCalledWith({ note: "value 2" });

    // Older (first) refresh resolves later — must be dropped.
    resolvers[0]!(createJsonResponse({ value: 1 }));
    await flushAsyncWork();
    expect(config.presentation.onStateChange).toHaveBeenLastCalledWith({ note: "value 2" });
  });

  it("(d) swallows abort errors without publishing unavailable", async () => {
    let rejectFetch: (reason: unknown) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<ReturnType<typeof createJsonResponse>>((_resolve, reject) => {
          rejectFetch = reject;
        })
    );
    const config = makeConfig({ fetchImpl });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    await flushAsyncWork();

    rejectFetch!(new DOMException("The operation was aborted.", "AbortError"));
    await flushAsyncWork();

    const last = (config.presentation.onStateChange as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(last?.[0]?.note).not.toBe(UNAVAILABLE.note);
  });

  it("(e) parse === null removes the overlay and publishes unavailable", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ nope: true }));
    const config = makeConfig({ fetchImpl });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    await flushAsyncWork();

    expect(map.addSource).not.toHaveBeenCalled();
    expect(config.presentation.onStateChange).toHaveBeenLastCalledWith(UNAVAILABLE);
  });

  it("(f) deduplicates publishes via equals", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ value: 7 }));
    const config = makeConfig({ fetchImpl, refreshIntervalMs: 5 });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    await flushAsyncWork();
    const callCount = (config.presentation.onStateChange as ReturnType<typeof vi.fn>).mock.calls.length;

    // Same frame again → no new onStateChange.
    await vi.advanceTimersByTimeAsync(5);
    await flushAsyncWork();

    expect(config.presentation.onStateChange).toHaveBeenCalledTimes(callCount);
  });

  it("(g) invokes onBeforeEnable on enable and onDisable on disable", async () => {
    const onBeforeEnable = vi.fn();
    const onDisable = vi.fn();
    const config = makeConfig({ onBeforeEnable, onDisable });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    expect(onBeforeEnable).toHaveBeenCalledTimes(1);
    expect(onDisable).not.toHaveBeenCalled();

    await flushAsyncWork();
    overlay.disable(map as never);
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("(h) same-map re-enable with shouldReassertOnEnable reasserts and suppresses inactive publish", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ value: 1 }));
    const reassert = vi.fn((map: import("maplibre-gl").Map) => {
      if (!map.getLayer(LAYER_ID)) map.addLayer({ id: LAYER_ID } as never);
      if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, { type: "geojson" } as never);
    });
    const config = makeConfig({
      fetchImpl,
      shouldReassertOnEnable: (map) => !map.getSource(SOURCE_ID) || !map.getLayer(LAYER_ID),
      reassert
    });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    await flushAsyncWork();
    expect(map.getSource(SOURCE_ID)).toBeTruthy();

    // Tear the overlay out from under the factory, then re-enable.
    map.removeLayer(LAYER_ID);
    map.removeSource(SOURCE_ID);
    const callsBefore = (config.presentation.onStateChange as ReturnType<typeof vi.fn>).mock.calls.length;

    overlay.enable(map as never);

    // reassert ran (re-added the layer/source synchronously) and inactive was
    // NOT published (suppressed during reassertion).
    expect(reassert).toHaveBeenCalledTimes(1);
    expect(map.getLayer(LAYER_ID)).toBeTruthy();
    const onStateChange = config.presentation.onStateChange as ReturnType<typeof vi.fn>;
    const newCalls = onStateChange.mock.calls.slice(callsBefore);
    expect(newCalls.every((c) => c[0].note !== INACTIVE.note)).toBe(true);
  });

  it("(i) repeated enable on same map without reassert is a no-op", async () => {
    const fetchImpl = vi.fn(async () => createJsonResponse({ value: 1 }));
    const config = makeConfig({ fetchImpl });
    const map = createMockMap();
    const overlay = createPollingOverlay(config);

    overlay.enable(map as never);
    overlay.enable(map as never);
    await flushAsyncWork();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });
});
