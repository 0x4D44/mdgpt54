import { describe, expect, it } from "vitest";

import {
  formatBearing,
  formatDistance,
  geodesicBearing,
  geodesicDistanceMeters,
  geodesicIntermediatePoints,
  type LngLat
} from "./measureGeodesic";

// ---------------------------------------------------------------------------
// geodesicDistanceMeters
// ---------------------------------------------------------------------------

describe("geodesicDistanceMeters", () => {
  it("returns 0 for the same point", () => {
    const p: LngLat = { lng: -3.19, lat: 55.95 };
    expect(geodesicDistanceMeters(p, p)).toBe(0);
  });

  it("Edinburgh to London is approximately 534 km", () => {
    const edinburgh: LngLat = { lng: -3.19, lat: 55.95 };
    const london: LngLat = { lng: -0.12, lat: 51.51 };
    const distance = geodesicDistanceMeters(edinburgh, london);
    // Known great-circle distance ~534 km, allow 1% tolerance
    expect(distance).toBeGreaterThan(528_000);
    expect(distance).toBeLessThan(540_000);
  });

  it("London to New York is approximately 5,570 km", () => {
    const london: LngLat = { lng: -0.12, lat: 51.51 };
    const nyc: LngLat = { lng: -74.01, lat: 40.71 };
    const distance = geodesicDistanceMeters(london, nyc);
    expect(distance).toBeGreaterThan(5_500_000);
    expect(distance).toBeLessThan(5_600_000);
  });

  it("antipodal points are approximately half Earth circumference (~20,015 km)", () => {
    const a: LngLat = { lng: 0, lat: 0 };
    const b: LngLat = { lng: 180, lat: 0 };
    const distance = geodesicDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(20_000_000);
    expect(distance).toBeLessThan(20_040_000);
  });

  it("is symmetric: distance(a, b) equals distance(b, a)", () => {
    const a: LngLat = { lng: 139.76, lat: 35.68 };
    const b: LngLat = { lng: -122.33, lat: 47.61 };
    expect(geodesicDistanceMeters(a, b)).toBeCloseTo(geodesicDistanceMeters(b, a), 1);
  });
});

// ---------------------------------------------------------------------------
// geodesicBearing
// ---------------------------------------------------------------------------

describe("geodesicBearing", () => {
  it("due north returns approximately 0 degrees", () => {
    const from: LngLat = { lng: 0, lat: 0 };
    const to: LngLat = { lng: 0, lat: 10 };
    const bearing = geodesicBearing(from, to);
    expect(bearing).toBeCloseTo(0, 0);
  });

  it("due south returns approximately 180 degrees", () => {
    const from: LngLat = { lng: 0, lat: 10 };
    const to: LngLat = { lng: 0, lat: 0 };
    const bearing = geodesicBearing(from, to);
    expect(bearing).toBeCloseTo(180, 0);
  });

  it("due east from equator returns approximately 90 degrees", () => {
    const from: LngLat = { lng: 0, lat: 0 };
    const to: LngLat = { lng: 90, lat: 0 };
    const bearing = geodesicBearing(from, to);
    expect(bearing).toBeCloseTo(90, 0);
  });

  it("due west from equator returns approximately 270 degrees", () => {
    const from: LngLat = { lng: 90, lat: 0 };
    const to: LngLat = { lng: 0, lat: 0 };
    const bearing = geodesicBearing(from, to);
    expect(bearing).toBeCloseTo(270, 0);
  });

  it("result is always in [0, 360)", () => {
    // Bearings should never be negative or >= 360
    const cases: Array<[LngLat, LngLat]> = [
      [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }],
      [{ lng: 170, lat: 0 }, { lng: -170, lat: 0 }],
      [{ lng: -170, lat: 0 }, { lng: 170, lat: 0 }]
    ];
    for (const [from, to] of cases) {
      const bearing = geodesicBearing(from, to);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });
});

// ---------------------------------------------------------------------------
// geodesicIntermediatePoints
// ---------------------------------------------------------------------------

describe("geodesicIntermediatePoints", () => {
  it("returns segments+1 points (including endpoints)", () => {
    const a: LngLat = { lng: 0, lat: 0 };
    const b: LngLat = { lng: 10, lat: 10 };
    const points = geodesicIntermediatePoints(a, b, 4);
    // 4 segments -> 5 points
    expect(points).toHaveLength(5);
  });

  it("first and last points match the input coordinates", () => {
    const a: LngLat = { lng: -3.19, lat: 55.95 };
    const b: LngLat = { lng: -0.12, lat: 51.51 };
    const points = geodesicIntermediatePoints(a, b, 8);
    expect(points[0].lng).toBeCloseTo(a.lng, 5);
    expect(points[0].lat).toBeCloseTo(a.lat, 5);
    expect(points[points.length - 1].lng).toBeCloseTo(b.lng, 5);
    expect(points[points.length - 1].lat).toBeCloseTo(b.lat, 5);
  });

  it("midpoint of equatorial pair lies on equator", () => {
    const a: LngLat = { lng: 0, lat: 0 };
    const b: LngLat = { lng: 60, lat: 0 };
    const points = geodesicIntermediatePoints(a, b, 2);
    // Midpoint should be at (30, 0)
    expect(points[1].lat).toBeCloseTo(0, 5);
    expect(points[1].lng).toBeCloseTo(30, 5);
  });

  it("returns a single point when both inputs are the same", () => {
    const p: LngLat = { lng: 10, lat: 20 };
    const points = geodesicIntermediatePoints(p, p, 8);
    expect(points).toHaveLength(1);
  });

  it("segments=1 returns 2 points (start and end)", () => {
    const a: LngLat = { lng: 0, lat: 0 };
    const b: LngLat = { lng: 90, lat: 0 };
    const points = geodesicIntermediatePoints(a, b, 1);
    expect(points).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------

describe("formatDistance", () => {
  it("formats small distances in meters with feet", () => {
    expect(formatDistance(100)).toBe("100 m (328 ft)");
  });

  it("formats 1000 m as km with miles", () => {
    expect(formatDistance(1000)).toBe("1.0 km (0.6 mi)");
  });

  it("formats large distances in km with miles", () => {
    // 5,570,000 m = 5,570 km
    const result = formatDistance(5_570_000);
    expect(result).toContain("5,570.0 km");
    expect(result).toContain("mi");
  });

  it("formats 0 meters", () => {
    expect(formatDistance(0)).toBe("0 m (0 ft)");
  });

  it("rounds meters to whole numbers", () => {
    expect(formatDistance(123.7)).toBe("124 m (406 ft)");
  });
});

// ---------------------------------------------------------------------------
// formatBearing
// ---------------------------------------------------------------------------

describe("formatBearing", () => {
  it("zero-pads to 3 digits with one decimal", () => {
    expect(formatBearing(0)).toBe("000.0°");
  });

  it("formats 45.2 correctly", () => {
    expect(formatBearing(45.2)).toBe("045.2°");
  });

  it("formats 359.9 correctly", () => {
    expect(formatBearing(359.9)).toBe("359.9°");
  });

  it("formats 180 correctly", () => {
    expect(formatBearing(180)).toBe("180.0°");
  });

  it("formats single-digit bearing with padding", () => {
    expect(formatBearing(5.5)).toBe("005.5°");
  });
});
