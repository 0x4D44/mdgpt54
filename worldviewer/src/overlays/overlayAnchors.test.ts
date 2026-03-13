import { describe, expect, it } from "vitest";

import {
  findFirstLabelLayerId,
  findFirstNonBaseContentLayerId,
  findFirstRoadLayerId,
  findSatelliteImageryLayerId,
  type OverlayAnchorLayer
} from "./overlayAnchors";

function makeLayer(
  id: string,
  type: OverlayAnchorLayer["type"],
  extra: Partial<OverlayAnchorLayer> = {}
): OverlayAnchorLayer {
  return {
    id,
    type,
    ...extra
  };
}

describe("overlayAnchors", () => {
  it("returns the earliest label layer in style order even when a known id appears later", () => {
    const layers = [
      makeLayer("settlement_names", "symbol", {
        layout: { "text-field": ["get", "name"] }
      }),
      makeLayer("label_city", "symbol")
    ];

    expect(findFirstLabelLayerId(layers)).toBe("settlement_names");
  });

  it("recognizes known label ids when they are the first label-like layer", () => {
    const layers = [
      makeLayer("landcover", "fill"),
      makeLayer("label_city", "symbol"),
      makeLayer("roads", "line")
    ];

    expect(findFirstLabelLayerId(layers)).toBe("label_city");
  });

  it("returns the earliest satellite raster layer in style order even when a known id appears later", () => {
    const layers = [
      makeLayer("base-imagery", "raster", { source: "satellite" }),
      makeLayer("satellite-imagery", "raster", { source: "satellite" })
    ];

    expect(findSatelliteImageryLayerId(layers)).toBe("base-imagery");
  });

  it("falls back to the first raster satellite layer when the known id is absent", () => {
    const layers = [
      makeLayer("background", "background"),
      makeLayer("eox-imagery", "raster", { source: "satellite" })
    ];

    expect(findSatelliteImageryLayerId(layers)).toBe("eox-imagery");
  });

  it("returns the earliest road layer in style order even when a known id appears later", () => {
    const layers = [
      makeLayer("minor-road-casing", "line"),
      makeLayer("road_secondary_tertiary", "line")
    ];

    expect(findFirstRoadLayerId(layers)).toBe("minor-road-casing");
  });

  it("falls back to the first road-like line layer", () => {
    const layers = [
      makeLayer("waterway", "line"),
      makeLayer("minor-road-casing", "line")
    ];

    expect(findFirstRoadLayerId(layers)).toBe("minor-road-casing");
  });

  it("finds the first layer after the last obscuring base layer when styles interleave", () => {
    const layers = [
      makeLayer("background", "background"),
      makeLayer("admin-boundary", "line"),
      makeLayer("3d-buildings", "fill-extrusion"),
      makeLayer("settlement-dots", "circle"),
      makeLayer("settlement_names", "symbol", {
        layout: { "text-field": ["get", "name"] }
      })
    ];

    expect(findFirstNonBaseContentLayerId(layers)).toBe("settlement-dots");
  });

  it("returns undefined when the style has only base-obscuring layers", () => {
    const layers = [
      makeLayer("background", "background"),
      makeLayer("land", "fill"),
      makeLayer("3d-buildings", "fill-extrusion"),
      makeLayer("hillshade", "hillshade"),
      makeLayer("imagery", "raster", { source: "satellite" })
    ];

    expect(findFirstNonBaseContentLayerId(layers)).toBeUndefined();
  });
});
