import { describe, expect, it, vi } from "vitest";

import {
  calculateApproxAltitude,
  classifyView,
  formatDistance,
  formatElevation,
  getTerrainHeight,
  syncMetrics
} from "./metricUI";

describe("classifyView", () => {
  it("returns Orbit below zoom 3", () => {
    expect(classifyView(0)).toBe("Orbit");
    expect(classifyView(2)).toBe("Orbit");
    expect(classifyView(2.99)).toBe("Orbit");
  });

  it("switches to Continental at exactly zoom 3", () => {
    expect(classifyView(3)).toBe("Continental");
    expect(classifyView(5)).toBe("Continental");
    expect(classifyView(6.99)).toBe("Continental");
  });

  it("switches to Regional at exactly zoom 7", () => {
    expect(classifyView(7)).toBe("Regional");
    expect(classifyView(9)).toBe("Regional");
    expect(classifyView(10.99)).toBe("Regional");
  });

  it("switches to Metro at exactly zoom 11", () => {
    expect(classifyView(11)).toBe("Metro");
    expect(classifyView(12)).toBe("Metro");
    expect(classifyView(13.99)).toBe("Metro");
  });

  it("switches to Street at exactly zoom 14", () => {
    expect(classifyView(14)).toBe("Street");
    expect(classifyView(18)).toBe("Street");
  });
});

describe("formatDistance", () => {
  it("formats sub-1000 values as meters", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(500)).toBe("500 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it("formats 1000+ values as kilometres with one decimal", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(12345)).toBe("12.3 km");
  });

  it("rounds sub-1000 values to the nearest integer", () => {
    expect(formatDistance(99.4)).toBe("99 m");
    expect(formatDistance(99.5)).toBe("100 m");
  });
});

describe("formatElevation", () => {
  it("returns Off when terrain is disabled regardless of value", () => {
    expect(formatElevation(null, false)).toBe("Off");
    expect(formatElevation(100, false)).toBe("Off");
    expect(formatElevation(0, false)).toBe("Off");
  });

  it("returns -- when terrain is enabled but elevation is null", () => {
    expect(formatElevation(null, true)).toBe("--");
  });

  it("formats valid elevation as rounded meters", () => {
    expect(formatElevation(100.6, true)).toBe("101 m");
    expect(formatElevation(0, true)).toBe("0 m");
    expect(formatElevation(8848.4, true)).toBe("8848 m");
  });

  it("handles negative elevation", () => {
    expect(formatElevation(-420.3, true)).toBe("-420 m");
  });
});

describe("calculateApproxAltitude", () => {
  const VIEWPORT = 800;

  it("returns lower altitude at higher zoom levels", () => {
    const altZ5 = calculateApproxAltitude(5, 0, VIEWPORT);
    const altZ10 = calculateApproxAltitude(10, 0, VIEWPORT);
    const altZ15 = calculateApproxAltitude(15, 0, VIEWPORT);
    expect(altZ5).toBeGreaterThan(altZ10);
    expect(altZ10).toBeGreaterThan(altZ15);
  });

  it("halves altitude at 60° latitude compared to the equator", () => {
    const equator = calculateApproxAltitude(10, 0, VIEWPORT);
    const lat60 = calculateApproxAltitude(10, 60, VIEWPORT);
    expect(lat60).toBeCloseTo(equator * 0.5, 0);
  });

  it("scales linearly with viewport height", () => {
    const alt800 = calculateApproxAltitude(10, 0, 800);
    const alt1600 = calculateApproxAltitude(10, 0, 1600);
    expect(alt1600).toBeCloseTo(alt800 * 2);
  });

  it("computes a concrete value matching the Web Mercator formula", () => {
    // At zoom 0, equator, viewport 2: one full pixel → metersPerPixel * 1
    const alt = calculateApproxAltitude(0, 0, 2);
    expect(alt).toBeCloseTo(156543.03392, 2);
  });
});

describe("getTerrainHeight", () => {
  it("returns null when terrain is disabled", () => {
    const map = {} as any;
    expect(getTerrainHeight(map, false)).toBeNull();
  });

  it("returns null when queryTerrainElevation returns null", () => {
    const map = {
      queryTerrainElevation: vi.fn(() => null),
      getCenter: vi.fn(() => ({ lat: 51, lng: 0 }))
    } as any;
    expect(getTerrainHeight(map, true)).toBeNull();
  });

  it("normalizes exaggerated terrain elevation", () => {
    const map = {
      queryTerrainElevation: vi.fn(() => 200),
      getCenter: vi.fn(() => ({ lat: 51, lng: 0 })),
      getTerrain: vi.fn(() => ({ exaggeration: 2 }))
    } as any;
    expect(getTerrainHeight(map, true)).toBe(100);
  });

  it("uses exaggeration of 1 when getTerrain returns null", () => {
    const map = {
      queryTerrainElevation: vi.fn(() => 100),
      getCenter: vi.fn(() => ({ lat: 51, lng: 0 })),
      getTerrain: vi.fn(() => null)
    } as any;
    expect(getTerrainHeight(map, true)).toBe(100);
  });
});

describe("syncMetrics", () => {
  it("populates all metric elements from map state", () => {
    vi.stubGlobal("window", { innerHeight: 900 });

    const elements = {
      metricMode: { textContent: "" },
      metricZoom: { textContent: "" },
      metricAltitude: { textContent: "" },
      metricPitch: { textContent: "" },
      metricTerrain: { textContent: "" }
    };

    const map = {
      getZoom: vi.fn(() => 10),
      getPitch: vi.fn(() => 45),
      getCenter: vi.fn(() => ({ lat: 51, lng: 0 })),
      queryTerrainElevation: vi.fn(() => null),
      getTerrain: vi.fn(() => null)
    } as any;

    syncMetrics(map, elements as any, true);

    expect(elements.metricZoom.textContent).toBe("10.00");
    expect(elements.metricPitch.textContent).toBe("45\u00B0");
    expect(elements.metricMode.textContent).toBe("Regional");
    expect(elements.metricAltitude.textContent).toMatch(/\d/);
    expect(elements.metricTerrain.textContent).toBe("--");

    vi.unstubAllGlobals();
  });

  it("shows terrain elevation when available", () => {
    vi.stubGlobal("window", { innerHeight: 900 });

    const elements = {
      metricMode: { textContent: "" },
      metricZoom: { textContent: "" },
      metricAltitude: { textContent: "" },
      metricPitch: { textContent: "" },
      metricTerrain: { textContent: "" }
    };

    const map = {
      getZoom: vi.fn(() => 14),
      getPitch: vi.fn(() => 0),
      getCenter: vi.fn(() => ({ lat: 0, lng: 0 })),
      queryTerrainElevation: vi.fn(() => 500),
      getTerrain: vi.fn(() => ({ exaggeration: 1 }))
    } as any;

    syncMetrics(map, elements as any, true);

    expect(elements.metricTerrain.textContent).toBe("500 m");
    expect(elements.metricMode.textContent).toBe("Street");

    vi.unstubAllGlobals();
  });
});
