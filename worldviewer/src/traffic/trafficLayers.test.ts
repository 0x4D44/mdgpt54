import { afterEach, describe, expect, it, vi } from "vitest";

class MockPopup {
  static instances: MockPopup[] = [];

  removed = false;

  constructor() {
    MockPopup.instances.push(this);
  }

  setLngLat() {
    return this;
  }

  setHTML() {
    return this;
  }

  addTo() {
    return this;
  }

  remove() {
    this.removed = true;
    return this;
  }
}

vi.mock("maplibre-gl", () => ({
  Popup: MockPopup
}));

function createAircraftTrack(id = "aircraft-1") {
  return {
    id,
    kind: "aircraft" as const,
    lng: -3.3,
    lat: 55.95,
    heading: 90,
    speedKnots: 240,
    altitudeMeters: 10000,
    label: "Test aircraft",
    source: "opensky" as const,
    updatedAt: 123
  };
}

function createShipTrack(id = "ship-1") {
  return {
    id,
    kind: "ship" as const,
    lng: -3.3,
    lat: 55.95,
    heading: 90,
    speedKnots: 12,
    altitudeMeters: null,
    label: "Test ship",
    source: "aisstream" as const,
    updatedAt: 123
  };
}

function createSnapshot(aircraft = [createAircraftTrack()], ships = [createShipTrack()]) {
  return {
    type: "snapshot" as const,
    aircraft,
    ships,
    serverTime: 123,
    status: {
      aircraft: { code: "ok" as const, message: null },
      ships: { code: "ok" as const, message: null }
    }
  };
}

function makeMap() {
  const handlers = new Map<string, (event: any) => void>();
  const sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {
    "live-aircraft": { setData: vi.fn() },
    "live-ships": { setData: vi.fn() },
    "aircraft-trails": { setData: vi.fn() }
  };

  return {
    handlers,
    sources,
    addSource: vi.fn(),
    hasImage: vi.fn(() => true),
    addImage: vi.fn(),
    addLayer: vi.fn(),
    on: vi.fn((eventName: string, layerId: string, handler: (event: any) => void) => {
      handlers.set(`${eventName}:${layerId}`, handler);
    }),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
    getSource: vi.fn((id: string) => sources[id] ?? null)
  };
}

describe("addTrafficLayers", () => {
  afterEach(() => {
    MockPopup.instances = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("falls back to transparent aircraft icons when canvas 2d is unavailable", async () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => null)
      }))
    });

    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();
    map.hasImage.mockReturnValue(false);

    expect(() => addTrafficLayers(map as any)).not.toThrow();
    expect(map.addImage).toHaveBeenCalled();

    for (const [, image] of map.addImage.mock.calls) {
      expect(image).toMatchObject({ width: 48, height: 48 });
      expect(image.data).toBeInstanceOf(Uint8ClampedArray);
      expect(image.data).toHaveLength(48 * 48 * 4);
    }
  });

  it("clears an aircraft popup when aircraft data is cleared", async () => {
    vi.resetModules();
    const { addTrafficLayers, clearAircraftData } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-aircraft-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { kind: "aircraft", id: "aircraft-1", updatedAt: 123 }
        }
      ]
    });

    const popup = MockPopup.instances.at(-1);
    expect(popup?.removed).toBe(false);

    clearAircraftData(map as any);

    expect(popup?.removed).toBe(true);
  });

  it("clears only the popup owned by the disabled layer", async () => {
    vi.resetModules();
    const { addTrafficLayers, clearAircraftData, clearShipsData } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-ships-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { kind: "ship", id: "ship-1", label: "Ship 1", updatedAt: 123 }
        }
      ]
    });

    const shipPopup = MockPopup.instances.at(-1);
    expect(shipPopup?.removed).toBe(false);

    clearAircraftData(map as any);
    expect(shipPopup?.removed).toBe(false);

    clearShipsData(map as any);
    expect(shipPopup?.removed).toBe(true);
  });

  it("clears a popup when snapshot data empties its owning layer", async () => {
    vi.resetModules();
    const { addTrafficLayers, updateTrafficData } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-ships-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { kind: "ship", id: "ship-1", label: "Ship 1", updatedAt: 123 }
        }
      ]
    });

    const shipPopup = MockPopup.instances.at(-1);
    expect(shipPopup?.removed).toBe(false);

    updateTrafficData(map as any, createSnapshot([], [createShipTrack()]));
    expect(shipPopup?.removed).toBe(false);

    updateTrafficData(map as any, createSnapshot([], []));
    expect(shipPopup?.removed).toBe(true);
  });

  it("adds 3 sources and 8 layers on fresh setup", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    expect(map.addSource).toHaveBeenCalledTimes(3);
    expect(map.addSource.mock.calls[0][0]).toBe("live-aircraft");
    expect(map.addSource.mock.calls[1][0]).toBe("live-ships");
    expect(map.addSource.mock.calls[2][0]).toBe("aircraft-trails");
    expect(map.addLayer).toHaveBeenCalledTimes(8);
  });

  it("skips already-loaded aircraft images", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();
    map.hasImage.mockReturnValue(true);

    addTrafficLayers(map as any);

    expect(map.addImage).not.toHaveBeenCalled();
  });

  it("renders aircraft icons via canvas 2d context", async () => {
    const fillCalls: string[] = [];
    const strokeCalls: number[] = [];
    const mockContext = {
      clearRect: vi.fn(),
      translate: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineJoin: "",
      lineCap: "",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => fillCalls.push("fill")),
      stroke: vi.fn(() => strokeCalls.push(1)),
      getImageData: vi.fn(() => ({
        width: 48,
        height: 48,
        data: new Uint8ClampedArray(48 * 48 * 4)
      }))
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockContext)
      }))
    });

    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();
    map.hasImage.mockReturnValue(false);

    addTrafficLayers(map as any);

    // 6 aircraft categories + 2 ship icons (ship-generic, ship-wake)
    expect(map.addImage).toHaveBeenCalledTimes(8);
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.translate).toHaveBeenCalled();
    expect(fillCalls.length).toBeGreaterThan(0);
  });

  it("sets cursor on mouseenter/mouseleave for interactive layers", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    const style = { cursor: "" };
    map.getCanvas.mockReturnValue({ style });

    map.handlers.get("mouseenter:live-aircraft-points")?.({});
    expect(style.cursor).toBe("pointer");

    map.handlers.get("mouseleave:live-aircraft-points")?.({});
    expect(style.cursor).toBe("");

    map.handlers.get("mouseenter:live-ships-points")?.({});
    expect(style.cursor).toBe("pointer");

    map.handlers.get("mouseleave:live-ships-points")?.({});
    expect(style.cursor).toBe("");
  });

  it("ignores click when no features present", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    // No features
    map.handlers.get("click:live-aircraft-points")?.({ features: [] });
    expect(MockPopup.instances).toHaveLength(0);

    // No features property
    map.handlers.get("click:live-aircraft-points")?.({});
    expect(MockPopup.instances).toHaveLength(0);
  });

  it("ignores click when geometry is not a Point", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-aircraft-points")?.({
      features: [
        {
          geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
          properties: { kind: "aircraft", id: "a1", updatedAt: 0 }
        }
      ]
    });

    expect(MockPopup.instances).toHaveLength(0);
  });

  it("ignores ship click when no features present", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-ships-points")?.({ features: [] });
    expect(MockPopup.instances).toHaveLength(0);

    map.handlers.get("click:live-ships-points")?.({
      features: [
        {
          geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
          properties: { kind: "ship", id: "s1", updatedAt: 0 }
        }
      ]
    });
    expect(MockPopup.instances).toHaveLength(0);
  });

  it("builds an aircraft popup with identity and metadata", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-aircraft-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: {
            kind: "aircraft",
            id: "A12345",
            label: "Flight ABC",
            callsign: "ABC123",
            flightCode: "AB 123",
            registration: "G-ABCD",
            aircraftTypeCode: "B738",
            manufacturer: "Boeing",
            model: "737-800",
            aircraftCategory: 3,
            speedKnots: 450,
            altitudeMeters: 11000,
            geoAltitudeMeters: 11050,
            updatedAt: Date.now(),
            source: "opensky"
          }
        }
      ]
    });

    expect(MockPopup.instances).toHaveLength(1);
  });

  it("builds a ship popup with source label", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-ships-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: {
            kind: "ship",
            id: "ship-1",
            label: "Vessel A",
            speedKnots: 12,
            updatedAt: Date.now(),
            source: "aisstream"
          }
        }
      ]
    });

    expect(MockPopup.instances).toHaveLength(1);
  });

  it("builds a ship popup for opensky source", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-ships-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: {
            kind: "ship",
            id: "ship-2",
            label: null,
            speedKnots: null,
            updatedAt: 0,
            source: "opensky"
          }
        }
      ]
    });

    expect(MockPopup.instances).toHaveLength(1);
  });

  it("replaces existing popup when clicking a new feature", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-aircraft-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { kind: "aircraft", id: "a1", updatedAt: 0 }
        }
      ]
    });

    const firstPopup = MockPopup.instances.at(-1)!;
    expect(firstPopup.removed).toBe(false);

    map.handlers.get("click:live-aircraft-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [3, 4] },
          properties: { kind: "aircraft", id: "a2", updatedAt: 0 }
        }
      ]
    });

    expect(firstPopup.removed).toBe(true);
    expect(MockPopup.instances).toHaveLength(2);
  });

  it("updateTrafficData sets data on both sources", async () => {
    vi.resetModules();
    const { addTrafficLayers, updateTrafficData } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    updateTrafficData(map as any, createSnapshot());

    expect(map.sources["live-aircraft"].setData).toHaveBeenCalledTimes(1);
    expect(map.sources["live-ships"].setData).toHaveBeenCalledTimes(1);
  });

  it("updateTrafficData passes hiddenAircraftIds for filtering", async () => {
    vi.resetModules();
    const { addTrafficLayers, updateTrafficData } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    const hidden = new Set(["aircraft-1"]);
    updateTrafficData(map as any, createSnapshot(), hidden);

    const data = map.sources["live-aircraft"].setData.mock.calls[0][0] as GeoJSON.FeatureCollection;
    // aircraft-1 is hidden (opacity 0), not removed
    expect(data.features).toHaveLength(1);
    expect((data.features[0].properties as Record<string, unknown>).opacity).toBe(0);
  });

  it("clearTrafficData clears both sources", async () => {
    vi.resetModules();
    const { addTrafficLayers, clearTrafficData } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    clearTrafficData(map as any);

    const aircraftData = map.sources["live-aircraft"].setData.mock.calls[0][0] as GeoJSON.FeatureCollection;
    const shipsData = map.sources["live-ships"].setData.mock.calls[0][0] as GeoJSON.FeatureCollection;
    expect(aircraftData.features).toHaveLength(0);
    expect(shipsData.features).toHaveLength(0);
  });

  it("handles missing sources gracefully in updateTrafficData", async () => {
    vi.resetModules();
    const { updateTrafficData } = await import("./trafficLayers");
    const map = makeMap();
    map.getSource.mockReturnValue(null as any);

    expect(() => updateTrafficData(map as any, createSnapshot())).not.toThrow();
  });

  it("builds ship popup with unknown ship when label and id are missing", async () => {
    vi.resetModules();
    const { addTrafficLayers } = await import("./trafficLayers");
    const map = makeMap();

    addTrafficLayers(map as any);

    map.handlers.get("click:live-ships-points")?.({
      features: [
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: {
            kind: "ship",
            id: null,
            label: null,
            speedKnots: null,
            updatedAt: 0,
            source: null
          }
        }
      ]
    });

    expect(MockPopup.instances).toHaveLength(1);
  });
});
