import { afterEach, describe, expect, it, vi } from "vitest";
import type { DemSourceLike, StyleBuildConfig } from "./mapStyle";
import {
  BUILDING_LAYER_ID,
  FLAT_BUILDING_LAYER_ID,
  buildMapStyle,
  selectFillOpacity,
  selectRoadOpacity
} from "./mapStyle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDemSource(): DemSourceLike {
  return {
    sharedDemProtocolUrl: "protocol://dem/{z}/{x}/{y}",
    contourProtocolUrl: vi.fn(() => "protocol://contour/{z}/{x}/{y}")
  };
}

function makeConfig(overrides: Partial<StyleBuildConfig> = {}): StyleBuildConfig {
  return {
    reliefEnabled: true,
    terrainExaggeration: 1.2,
    ...overrides
  };
}

/** Minimal base style that exercises every branch in the layer transform. */
function fakeBaseStyle() {
  return {
    version: 8,
    name: "test",
    sources: { openmaptiles: { type: "vector" } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#fff" } },
      {
        id: "natural_earth",
        type: "raster",
        paint: { "raster-opacity": 1 }
      },
      {
        id: "water",
        type: "fill",
        paint: { "fill-color": "#aad" }
      },
      {
        id: "landcover",
        type: "fill",
        paint: { "fill-color": "#ccc" }
      },
      {
        id: BUILDING_LAYER_ID,
        type: "fill-extrusion",
        paint: { "fill-extrusion-color": "#ddd" },
        layout: { visibility: "visible" }
      },
      {
        id: FLAT_BUILDING_LAYER_ID,
        type: "fill",
        paint: { "fill-color": "#eee" }
      },
      {
        id: "label_city",
        type: "symbol",
        paint: { "text-color": "#000" }
      },
      {
        id: "road_primary",
        type: "line",
        paint: { "line-color": "#aaa" }
      },
      {
        id: "road_primary_casing",
        type: "line",
        paint: { "line-color": "#bbb" }
      },
      {
        id: "road_area_pattern",
        type: "fill",
        paint: { "fill-color": "#ddd" }
      },
      {
        id: "some_no_paint_layer",
        type: "fill",
        source: "openmaptiles"
      },
      {
        id: "poi_r1",
        type: "symbol",
        paint: { "text-color": "#111" },
        layout: { "icon-size": 1 }
      }
    ]
  };
}

function stubFetchOk(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body)
      })
    )
  );
}

function stubFetchFail(status: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// selectFillOpacity
// ---------------------------------------------------------------------------

describe("selectFillOpacity", () => {
  it("returns water-specific stops for the 'water' layer", () => {
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
    const result = selectFillOpacity("landcover");
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

  it("returns the default branch for an arbitrary layer id", () => {
    const result = selectFillOpacity("unknown_xyz");
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[])[4]).toBe(0.08);
  });
});

// ---------------------------------------------------------------------------
// selectRoadOpacity
// ---------------------------------------------------------------------------

describe("selectRoadOpacity", () => {
  it("returns casing-specific stops for ids containing 'casing'", () => {
    const result = selectRoadOpacity("road_primary_casing");
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

  it("returns default road stops for non-casing roads", () => {
    const result = selectRoadOpacity("road_primary");
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

  it("differentiates casing from non-casing at the same zoom stops", () => {
    const casing = selectRoadOpacity("road_casing") as unknown[];
    const normal = selectRoadOpacity("road_fill") as unknown[];
    expect(casing[casing.length - 1]).not.toBe(normal[normal.length - 1]);
  });
});

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe("exported constants", () => {
  it("defines the 3d building layer id", () => {
    expect(BUILDING_LAYER_ID).toBe("building-3d");
  });

  it("defines the flat building layer id", () => {
    expect(FLAT_BUILDING_LAYER_ID).toBe("building");
  });
});

// ---------------------------------------------------------------------------
// buildMapStyle
// ---------------------------------------------------------------------------

describe("buildMapStyle", () => {
  it("throws when the style fetch fails", async () => {
    stubFetchFail(503);
    await expect(buildMapStyle(makeDemSource(), makeConfig())).rejects.toThrow(
      "Style request failed with 503."
    );
  });

  it("fetches the OpenFreeMap style URL", async () => {
    stubFetchOk(fakeBaseStyle());
    await buildMapStyle(makeDemSource(), makeConfig());
    expect(fetch).toHaveBeenCalledWith("https://tiles.openfreemap.org/styles/liberty");
  });

  it("returns a style with globe projection", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    expect(style.projection).toEqual({ type: "globe" });
  });

  it("includes terrain with the configured exaggeration", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(
      makeDemSource(),
      makeConfig({ terrainExaggeration: 1.8 })
    )) as any;
    expect(style.terrain.source).toBe("terrain-mesh");
    expect(style.terrain.exaggeration).toBe(1.8);
  });

  it("adds satellite, terrain-mesh, relief-dem, and contour sources", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    expect(style.sources.satellite).toBeDefined();
    expect(style.sources.satellite.type).toBe("raster");
    expect(style.sources["terrain-mesh"]).toBeDefined();
    expect(style.sources["terrain-mesh"].type).toBe("raster-dem");
    expect(style.sources["terrain-relief-dem"]).toBeDefined();
    expect(style.sources["terrain-contours"]).toBeDefined();
    expect(style.sources["terrain-contours"].type).toBe("vector");
  });

  it("preserves the original base sources", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    expect(style.sources.openmaptiles).toBeDefined();
  });

  it("calls contourProtocolUrl with the expected thresholds config", async () => {
    stubFetchOk(fakeBaseStyle());
    const demSource = makeDemSource();
    await buildMapStyle(demSource, makeConfig());
    expect(demSource.contourProtocolUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        contourLayer: "contours",
        elevationKey: "ele",
        levelKey: "level"
      })
    );
  });

  it("inserts satellite-imagery as the second layer (after background)", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    expect(style.layers[0].id).toBe("background");
    expect(style.layers[1].id).toBe("satellite-imagery");
    expect(style.layers[1].type).toBe("raster");
  });

  it("inserts terrain-hillshade right after satellite-imagery", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    expect(style.layers[2].id).toBe("terrain-hillshade");
    expect(style.layers[2].type).toBe("hillshade");
  });

  it("inserts contour layers before road_area_pattern", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const ids = style.layers.map((l: any) => l.id) as string[];
    const contourLineIdx = ids.indexOf("terrain-contours-line");
    const contourLabelIdx = ids.indexOf("terrain-contours-label");
    const roadAreaIdx = ids.indexOf("road_area_pattern");
    expect(contourLineIdx).toBeGreaterThan(-1);
    expect(contourLabelIdx).toBe(contourLineIdx + 1);
    expect(roadAreaIdx).toBe(contourLabelIdx + 1);
  });

  it("appends contour layers when road_area_pattern is absent", async () => {
    const base = fakeBaseStyle();
    base.layers = base.layers.filter((l) => l.id !== "road_area_pattern");
    stubFetchOk(base);
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const ids = style.layers.map((l: any) => l.id) as string[];
    expect(ids[ids.length - 2]).toBe("terrain-contours-line");
    expect(ids[ids.length - 1]).toBe("terrain-contours-label");
  });

  it("overrides background paint to dark color", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const bg = style.layers.find((l: any) => l.id === "background");
    expect(bg.paint["background-color"]).toBe("#050b14");
  });

  it("applies raster-opacity ramp to natural_earth layer", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const ne = style.layers.find((l: any) => l.id === "natural_earth");
    expect(ne.paint["raster-opacity"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.12,
      4,
      0.06,
      6,
      0
    ]);
  });

  it("applies fill-opacity to fill layers except flat building", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const water = style.layers.find((l: any) => l.id === "water");
    expect(water.paint["fill-opacity"]).toBeDefined();
    const landcover = style.layers.find((l: any) => l.id === "landcover");
    expect(landcover.paint["fill-opacity"]).toBeDefined();
  });

  it("gives the flat building layer its own opacity ramp, not the generic one", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const flat = style.layers.find((l: any) => l.id === FLAT_BUILDING_LAYER_ID);
    const arr = flat.paint["fill-opacity"] as unknown[];
    expect(arr).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      13,
      0.18,
      14,
      0.3
    ]);
  });

  it("sets fill-outline-color on flat building layer", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const flat = style.layers.find((l: any) => l.id === FLAT_BUILDING_LAYER_ID);
    expect(flat.paint["fill-outline-color"]).toBe("rgba(255,255,255,0.18)");
  });

  it("customizes 3d building extrusion colors and opacity", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const b3d = style.layers.find((l: any) => l.id === BUILDING_LAYER_ID);
    expect(b3d.paint["fill-extrusion-opacity"]).toBe(0.86);
    expect(Array.isArray(b3d.paint["fill-extrusion-color"])).toBe(true);
    expect(b3d.paint["fill-extrusion-color"][0]).toBe("interpolate");
  });

  it("applies dark-mode halo to label layers", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const labelCity = style.layers.find((l: any) => l.id === "label_city");
    expect(labelCity.paint["text-halo-color"]).toBe("rgba(13, 17, 24, 0.88)");
    expect(labelCity.paint["text-halo-width"]).toBe(1.2);
    expect(labelCity.paint["text-color"]).toBe("#f7fafc");
  });

  it("applies dark-mode halo to poi label layers", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const poi = style.layers.find((l: any) => l.id === "poi_r1");
    expect(poi.paint["text-halo-color"]).toBe("rgba(13, 17, 24, 0.88)");
    expect(poi.paint["text-color"]).toBe("#f7fafc");
  });

  it("applies road opacity to road line layers", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const road = style.layers.find((l: any) => l.id === "road_primary");
    expect(road.paint["line-opacity"]).toBeDefined();
    const casing = style.layers.find((l: any) => l.id === "road_primary_casing");
    expect(casing.paint["line-opacity"]).toBeDefined();
  });

  it("does not mutate the original base style object", async () => {
    const base = fakeBaseStyle();
    const origBgColor = base.layers[0].paint!["background-color"];
    stubFetchOk(base);
    await buildMapStyle(makeDemSource(), makeConfig());
    expect(base.layers[0].paint!["background-color"]).toBe(origBgColor);
  });

  it("handles layers without paint or layout gracefully", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const noPaint = style.layers.find((l: any) => l.id === "some_no_paint_layer");
    expect(noPaint).toBeDefined();
    expect(noPaint.source).toBe("openmaptiles");
  });

  it("preserves layout properties when cloning layers", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const b3d = style.layers.find((l: any) => l.id === BUILDING_LAYER_ID);
    expect(b3d.layout.visibility).toBe("visible");
    const poi = style.layers.find((l: any) => l.id === "poi_r1");
    expect(poi.layout["icon-size"]).toBe(1);
  });

  it("uses reliefEnabled for satellite opacity calculation", async () => {
    stubFetchOk(fakeBaseStyle());
    const style = (await buildMapStyle(
      makeDemSource(),
      makeConfig({ reliefEnabled: false })
    )) as any;
    const sat = style.layers.find((l: any) => l.id === "satellite-imagery");
    expect(sat.paint["raster-opacity"]).toBeDefined();
  });

  it("does not apply road opacity to non-road line layers", async () => {
    const base = fakeBaseStyle();
    base.layers.push({
      id: "boundary_line",
      type: "line",
      paint: { "line-color": "#999" }
    });
    stubFetchOk(base);
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const boundary = style.layers.find((l: any) => l.id === "boundary_line");
    expect(boundary.paint["line-opacity"]).toBeUndefined();
  });

  it("does not apply label halo to non-label symbol layers", async () => {
    const base = fakeBaseStyle();
    base.layers.push({
      id: "custom_symbol",
      type: "symbol",
      paint: { "text-color": "#aaa" }
    });
    stubFetchOk(base);
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const custom = style.layers.find((l: any) => l.id === "custom_symbol");
    expect(custom.paint["text-halo-color"]).toBeUndefined();
  });

  it("applies background paint even when paint was initially missing", async () => {
    const base = fakeBaseStyle();
    base.layers[0] = { id: "background", type: "background" } as any;
    stubFetchOk(base);
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const bg = style.layers.find((l: any) => l.id === "background");
    expect(bg.paint["background-color"]).toBe("#050b14");
  });

  it("skips natural_earth raster-opacity when paint is missing", async () => {
    const base = fakeBaseStyle();
    const ne = base.layers.find((l) => l.id === "natural_earth")!;
    delete (ne as any).paint;
    stubFetchOk(base);
    const style = (await buildMapStyle(makeDemSource(), makeConfig())) as any;
    const neResult = style.layers.find((l: any) => l.id === "natural_earth");
    expect(neResult.paint).toBeUndefined();
  });
});
