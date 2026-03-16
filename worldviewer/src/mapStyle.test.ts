import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildMapStyle,
  selectFillOpacity,
  selectRoadOpacity,
  BUILDING_LAYER_ID,
  FLAT_BUILDING_LAYER_ID,
  type DemSourceLike,
  type StyleBuildConfig
} from "./mapStyle";

describe("selectFillOpacity", () => {
  it("returns water-specific stops for 'water' layer", () => {
    const result = selectFillOpacity("water");
    expect(result).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.25,
      8,
      0.2,
      14,
      0.08
    ]);
  });

  it("returns default stops for non-water layers", () => {
    const result = selectFillOpacity("landuse");
    expect(result).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.08,
      10,
      0.05,
      14,
      0.02
    ]);
  });
});

describe("selectRoadOpacity", () => {
  it("returns casing stops for road casing layers", () => {
    const result = selectRoadOpacity("road_casing");
    expect(result).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      0,
      10,
      0.22,
      16,
      0.45
    ]);
  });

  it("returns default stops for non-casing road layers", () => {
    const result = selectRoadOpacity("road_fill");
    expect(result).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      0,
      10,
      0.35,
      16,
      0.72
    ]);
  });
});

function createFakeBaseStyle() {
  return {
    version: 8,
    sources: {
      openmaptiles: { type: "vector", url: "https://example.com" }
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#fff" } },
      { id: "natural_earth", type: "raster", paint: { "raster-opacity": 1 } },
      { id: "water", type: "fill", paint: { "fill-color": "blue" } },
      { id: "landuse", type: "fill", paint: { "fill-color": "green" } },
      { id: BUILDING_LAYER_ID, type: "fill-extrusion", paint: { "fill-extrusion-color": "#ccc" } },
      { id: FLAT_BUILDING_LAYER_ID, type: "fill", paint: { "fill-color": "#ddd" } },
      { id: "label_city", type: "symbol", paint: { "text-color": "black" }, layout: { "text-field": "{name}" } },
      { id: "road_primary", type: "line", paint: { "line-color": "#333" } },
      { id: "road_primary_casing", type: "line", paint: { "line-color": "#333" } },
      { id: "road_area_pattern", type: "fill", paint: {} },
      { id: "other_line", type: "line", paint: { "line-color": "#000" } }
    ]
  };
}

function createDemSource(): DemSourceLike {
  return {
    sharedDemProtocolUrl: "protocol://dem/{z}/{x}/{y}",
    contourProtocolUrl: () => "protocol://contour/{z}/{x}/{y}"
  };
}

const defaultConfig: StyleBuildConfig = {
  reliefEnabled: true,
  terrainExaggeration: 1.5
};

describe("buildMapStyle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the base style and produces a complete styled map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);

    expect(result).toBeDefined();
    expect((result as any).projection).toEqual({ type: "globe" });
    expect((result as any).terrain.exaggeration).toBe(1.5);
    expect((result as any).sources.satellite).toBeDefined();
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }))
    );

    await expect(buildMapStyle(createDemSource(), defaultConfig)).rejects.toThrow("503");
  });

  it("transforms background to dark color", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const bg = (result as any).layers.find((l: any) => l.id === "background");
    expect(bg.paint["background-color"]).toBe("#050b14");
  });

  it("applies natural_earth raster opacity stops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const ne = (result as any).layers.find((l: any) => l.id === "natural_earth");
    expect(ne.paint["raster-opacity"]).toBeInstanceOf(Array);
  });

  it("applies fill opacity to fill layers except flat building", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const water = (result as any).layers.find((l: any) => l.id === "water");
    expect(water.paint["fill-opacity"]).toBeInstanceOf(Array);

    const flat = (result as any).layers.find((l: any) => l.id === FLAT_BUILDING_LAYER_ID);
    expect(flat.paint["fill-opacity"]).toBeInstanceOf(Array);
  });

  it("applies building 3d paint properties", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const building = (result as any).layers.find((l: any) => l.id === BUILDING_LAYER_ID);
    expect(building.paint["fill-extrusion-opacity"]).toBe(0.86);
    expect(building.paint["fill-extrusion-color"]).toBeInstanceOf(Array);
  });

  it("styles label layers with dark halo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const label = (result as any).layers.find((l: any) => l.id === "label_city");
    expect(label.paint["text-halo-color"]).toContain("rgba");
    expect(label.paint["text-color"]).toBe("#f7fafc");
  });

  it("applies road opacity to road_ line layers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const road = (result as any).layers.find((l: any) => l.id === "road_primary");
    expect(road.paint["line-opacity"]).toBeInstanceOf(Array);
  });

  it("inserts contour layers before road_area_pattern", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const layerIds = (result as any).layers.map((l: any) => l.id);
    const contourIdx = layerIds.indexOf("terrain-contours-line");
    const roadAreaIdx = layerIds.indexOf("road_area_pattern");
    expect(contourIdx).toBeLessThan(roadAreaIdx);
  });

  it("appends contour layers when road_area_pattern is absent", async () => {
    const style = createFakeBaseStyle();
    style.layers = style.layers.filter((l) => l.id !== "road_area_pattern");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => style
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const layerIds = (result as any).layers.map((l: any) => l.id);
    expect(layerIds.at(-1)).toBe("terrain-contours-label");
    expect(layerIds.at(-2)).toBe("terrain-contours-line");
  });

  it("inserts satellite and hillshade after background", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => createFakeBaseStyle()
      }))
    );

    const result = await buildMapStyle(createDemSource(), defaultConfig);
    const layerIds = (result as any).layers.map((l: any) => l.id);
    expect(layerIds[0]).toBe("background");
    expect(layerIds[1]).toBe("satellite-imagery");
    expect(layerIds[2]).toBe("terrain-hillshade");
  });
});
