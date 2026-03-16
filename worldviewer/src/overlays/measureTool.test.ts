import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MEASURE_LINE_LAYER_ID,
  MEASURE_POINTS_LAYER_ID,
  MEASURE_SOURCE_ID,
  createMeasureTool,
  type MeasureResult,
  type MeasureState
} from "./measureTool";
import { createMockMap, type MockMap } from "./test/createMockMap";

type StateRecord = { state: MeasureState; result: MeasureResult | null };

function createKeydownTargetStub() {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
}

function createMeasureMockMap() {
  return createMockMap({
    defaultStyleLayers: [
      { id: "satellite-imagery", type: "raster", source: "satellite" },
      { id: "label_city", type: "symbol" }
    ],
    sourceFactory: (_id, source) => ({
      ...source,
      setData: vi.fn()
    })
  });
}

function enableTool(
  map: MockMap,
  onStateChange?: (state: MeasureState, result: MeasureResult | null) => void
) {
  const keydownTarget = createKeydownTargetStub();
  const tool = createMeasureTool({ onStateChange, keydownTarget });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool.enable(map as any);
  return { tool, keydownTarget };
}

describe("measureTool lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enable adds source and both layers", () => {
    const map = createMeasureMockMap();
    enableTool(map);

    expect(map.addSource).toHaveBeenCalledWith(MEASURE_SOURCE_ID, expect.objectContaining({ type: "geojson" }));
    expect(map.addLayer).toHaveBeenCalledTimes(2);

    const layerIds = map.addLayer.mock.calls.map((c: unknown[]) => (c[0] as { id: string }).id);
    expect(layerIds).toContain(MEASURE_LINE_LAYER_ID);
    expect(layerIds).toContain(MEASURE_POINTS_LAYER_ID);
  });

  it("disable removes layers and source", () => {
    const map = createMeasureMockMap();
    const { tool } = enableTool(map);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.disable(map as any);

    expect(map.removeLayer).toHaveBeenCalledWith(MEASURE_LINE_LAYER_ID);
    expect(map.removeLayer).toHaveBeenCalledWith(MEASURE_POINTS_LAYER_ID);
    expect(map.removeSource).toHaveBeenCalledWith(MEASURE_SOURCE_ID);
  });

  it("double-enable is idempotent (does not duplicate source)", () => {
    const map = createMeasureMockMap();
    const keydownTarget = createKeydownTargetStub();
    const tool = createMeasureTool({ keydownTarget });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.enable(map as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.enable(map as any);

    // Should only have added source once since the second enable sees it already exists
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  it("disable when not enabled is a no-op", () => {
    const map = createMeasureMockMap();
    const keydownTarget = createKeydownTargetStub();
    const tool = createMeasureTool({ keydownTarget });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.disable(map as any);

    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
  });

  it("enable defers setup when style is not loaded", () => {
    const map = createMeasureMockMap();
    map.styleLoaded = false;
    const keydownTarget = createKeydownTargetStub();
    const tool = createMeasureTool({ keydownTarget });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.enable(map as any);

    // Source not added yet
    expect(map.addSource).not.toHaveBeenCalled();
    // Registered load listener
    expect(map.on).toHaveBeenCalledWith("load", expect.any(Function));

    // Emit load -> now it should add
    map.emitLoad();
    expect(map.addSource).toHaveBeenCalledWith(MEASURE_SOURCE_ID, expect.objectContaining({ type: "geojson" }));
  });

  it("enable registers keydown listener on keydownTarget", () => {
    const map = createMeasureMockMap();
    const { keydownTarget } = enableTool(map);
    expect(keydownTarget.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("disable removes keydown listener from keydownTarget", () => {
    const map = createMeasureMockMap();
    const { tool, keydownTarget } = enableTool(map);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.disable(map as any);
    expect(keydownTarget.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});

describe("measureTool state machine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("first click transitions to first-click and fires onStateChange", () => {
    const map = createMeasureMockMap();
    const changes: StateRecord[] = [];
    const { tool } = enableTool(map, (state, result) => changes.push({ state, result }));

    // Find the click handler registered on the map
    const clickCall = map.on.mock.calls.find((c: unknown[]) => c[0] === "click");
    expect(clickCall).toBeDefined();

    const clickHandler = clickCall![1] as (e: unknown) => void;
    clickHandler({ lngLat: { lng: 10, lat: 20 } });

    expect(changes).toHaveLength(1);
    expect(changes[0].state).toBe("first-click");
    expect(changes[0].result).toBeNull();

    // Source should have been updated with a single point
    const source = map.getSource(MEASURE_SOURCE_ID);
    expect(source.setData).toHaveBeenCalled();

    // Cleanup
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.disable(map as any);
  });

  it("second click transitions to complete with distance and bearing", () => {
    const map = createMeasureMockMap();
    const changes: StateRecord[] = [];
    enableTool(map, (state, result) => changes.push({ state, result }));

    const clickHandler = map.on.mock.calls.find((c: unknown[]) => c[0] === "click")![1] as (e: unknown) => void;

    // First click
    clickHandler({ lngLat: { lng: 0, lat: 0 } });
    // Second click
    clickHandler({ lngLat: { lng: 1, lat: 0 } });

    expect(changes).toHaveLength(2);
    expect(changes[1].state).toBe("complete");
    expect(changes[1].result).not.toBeNull();
    expect(changes[1].result!.distanceMeters).toBeGreaterThan(100_000);
    expect(changes[1].result!.bearingDegrees).toBeCloseTo(90, 0);
    expect(changes[1].result!.from).toEqual({ lng: 0, lat: 0 });
    expect(changes[1].result!.to).toEqual({ lng: 1, lat: 0 });
  });

  it("third click resets and starts a new measurement from the click", () => {
    const map = createMeasureMockMap();
    const changes: StateRecord[] = [];
    enableTool(map, (state, result) => changes.push({ state, result }));

    const clickHandler = map.on.mock.calls.find((c: unknown[]) => c[0] === "click")![1] as (e: unknown) => void;

    clickHandler({ lngLat: { lng: 0, lat: 0 } });
    clickHandler({ lngLat: { lng: 1, lat: 0 } });
    // Third click restarts
    clickHandler({ lngLat: { lng: 5, lat: 5 } });

    expect(changes).toHaveLength(3);
    expect(changes[2].state).toBe("first-click");
    expect(changes[2].result).toBeNull();
  });

  it("disable fires onStateChange with idle", () => {
    const map = createMeasureMockMap();
    const changes: StateRecord[] = [];
    const { tool } = enableTool(map, (state, result) => changes.push({ state, result }));

    const clickHandler = map.on.mock.calls.find((c: unknown[]) => c[0] === "click")![1] as (e: unknown) => void;
    clickHandler({ lngLat: { lng: 0, lat: 0 } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool.disable(map as any);

    const last = changes[changes.length - 1];
    expect(last.state).toBe("idle");
    expect(last.result).toBeNull();
  });
});
