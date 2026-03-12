import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({
  Popup: class {
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
      return this;
    }
  }
}));

function makeMap() {
  return {
    addSource: vi.fn(),
    hasImage: vi.fn(() => false),
    addImage: vi.fn(),
    addLayer: vi.fn(),
    on: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } }))
  };
}

describe("addTrafficLayers", () => {
  afterEach(() => {
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

    expect(() => addTrafficLayers(map as any)).not.toThrow();
    expect(map.addImage).toHaveBeenCalled();

    for (const [, image] of map.addImage.mock.calls) {
      expect(image).toMatchObject({ width: 48, height: 48 });
      expect(image.data).toBeInstanceOf(Uint8ClampedArray);
      expect(image.data).toHaveLength(48 * 48 * 4);
    }
  });
});
