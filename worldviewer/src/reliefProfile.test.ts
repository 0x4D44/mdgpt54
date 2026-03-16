import { describe, expect, it } from "vitest";

import {
  CONTOUR_THRESHOLDS,
  CONTOUR_SOURCE_ID,
  DEFAULT_SATELLITE_OPACITY_STOPS,
  HILLSHADE_EXAGGERATION_STOPS,
  RELIEF_SATELLITE_OPACITY_STOPS,
  RELIEF_DEM_SOURCE_ID,
  RELIEF_LAYER_IDS,
  TERRAIN_MESH_SOURCE_ID,
  getHillshadeExaggerationExpression,
  getSatelliteOpacity,
  getTerrainExaggeration,
  normalizeTerrainElevation
} from "./reliefProfile";

describe("reliefProfile", () => {
  it("keeps relief layers grouped together", () => {
    expect(RELIEF_LAYER_IDS).toEqual([
      "terrain-hillshade",
      "terrain-contours-line",
      "terrain-contours-label"
    ]);
  });

  it("uses separate dem sources for terrain mesh and relief shading", () => {
    expect(TERRAIN_MESH_SOURCE_ID).not.toBe(RELIEF_DEM_SOURCE_ID);
    expect(CONTOUR_SOURCE_ID).toBe("terrain-contours");
  });

  it("tightens contour spacing as zoom increases", () => {
    expect(CONTOUR_THRESHOLDS[10][0]).toBeGreaterThan(CONTOUR_THRESHOLDS[14][0]);
    expect(CONTOUR_THRESHOLDS[11][1]).toBeGreaterThanOrEqual(CONTOUR_THRESHOLDS[14][1]);
  });

  it("removes terrain exaggeration from displayed elevation", () => {
    expect(normalizeTerrainElevation(240, 1.2)).toBeCloseTo(200);
    expect(normalizeTerrainElevation(125, 1)).toBe(125);
  });

  it("pushes exaggeration hardest in landscape terrain zooms", () => {
    expect(getTerrainExaggeration(4)).toBe(1.1);
    expect(getTerrainExaggeration(10)).toBe(2.35);
    expect(getTerrainExaggeration(16)).toBe(1.25);
  });

  it("backs off hillshade strength once street zooms would start exposing seams", () => {
    expect(HILLSHADE_EXAGGERATION_STOPS[2][1]).toBeGreaterThan(HILLSHADE_EXAGGERATION_STOPS[3][1]);
    expect(getHillshadeExaggerationExpression()).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      6,
      0.55,
      10,
      0.82,
      13,
      0.92,
      16,
      0.58
    ]);
  });

  it("keeps relief imagery opaque while leaving non-relief high-pitch suppression intact", () => {
    expect(DEFAULT_SATELLITE_OPACITY_STOPS[0][1]).toBe(1);
    expect(getSatelliteOpacity(10, 24, true)).toBe(1);
    expect(getSatelliteOpacity(10, 68, false)).toBeCloseTo(0.665);
  });

  it("keeps the relief surface opaque so terrain internals do not show through", () => {
    expect(RELIEF_SATELLITE_OPACITY_STOPS).toEqual([
      [0, 1],
      [17, 1]
    ]);
    expect(getSatelliteOpacity(10, 68, true)).toBe(1);
    expect(getSatelliteOpacity(12.5, 74, true)).toBe(1);
    expect(getSatelliteOpacity(16, 72, true)).toBe(1);
  });

  it("returns the first stop value when zoom is at or below the first stop", () => {
    expect(getSatelliteOpacity(0, 0, false)).toBeCloseTo(0.92);
  });

  it("returns the last stop value when zoom exceeds the final stop", () => {
    expect(getSatelliteOpacity(20, 0, false)).toBeCloseTo(0.76);
  });

  it("applies high-pitch and mid-zoom penalties to non-relief opacity", () => {
    expect(getSatelliteOpacity(10, 75, false)).toBeCloseTo(0.605);
  });

  it("covers every terrain exaggeration zoom bracket", () => {
    expect(getTerrainExaggeration(7)).toBe(1.45);
    expect(getTerrainExaggeration(12.5)).toBe(2.05);
    expect(getTerrainExaggeration(14.5)).toBe(1.65);
  });
});
