import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  interpolateGreatCircle,
  lookupAirportCoords,
  fetchFlightRoute,
  FLIGHT_ROUTE_SOURCE,
  FLIGHT_ROUTE_LAYER
} from "./flightRoute";

// ---------------------------------------------------------------------------
// interpolateGreatCircle
// ---------------------------------------------------------------------------
describe("interpolateGreatCircle", () => {
  it("returns the requested number of points (including endpoints)", () => {
    const start: [number, number] = [-0.46, 51.47]; // EGLL [lng, lat]
    const end: [number, number] = [-73.78, 40.64]; // KJFK
    const points = interpolateGreatCircle(start, end, 64);
    expect(points).toHaveLength(64);
  });

  it("includes start and end points as first and last entries", () => {
    const start: [number, number] = [-0.46, 51.47];
    const end: [number, number] = [-73.78, 40.64];
    const points = interpolateGreatCircle(start, end, 32);
    expect(points[0][0]).toBeCloseTo(-0.46, 2);
    expect(points[0][1]).toBeCloseTo(51.47, 2);
    expect(points[points.length - 1][0]).toBeCloseTo(-73.78, 2);
    expect(points[points.length - 1][1]).toBeCloseTo(40.64, 2);
  });

  it("generates intermediate points that lie on the great-circle path", () => {
    // EGLL to KJFK — the midpoint should be roughly in the mid-Atlantic (~53°N, ~35°W)
    const start: [number, number] = [-0.46, 51.47];
    const end: [number, number] = [-73.78, 40.64];
    const points = interpolateGreatCircle(start, end, 65);

    // Midpoint is index 32
    const mid = points[32];
    // Midpoint of EGLL-KJFK great circle is roughly [-35, 53] area
    expect(mid[0]).toBeGreaterThan(-50);
    expect(mid[0]).toBeLessThan(-20);
    expect(mid[1]).toBeGreaterThan(48);
    expect(mid[1]).toBeLessThan(58);
  });

  it("returns a single point when start equals end", () => {
    const point: [number, number] = [10.0, 50.0];
    const points = interpolateGreatCircle(point, point, 64);
    expect(points).toHaveLength(1);
    expect(points[0][0]).toBeCloseTo(10.0, 4);
    expect(points[0][1]).toBeCloseTo(50.0, 4);
  });

  it("handles very short distances correctly", () => {
    const a: [number, number] = [-0.46, 51.47];
    const b: [number, number] = [-0.45, 51.48];
    const points = interpolateGreatCircle(a, b, 10);
    expect(points).toHaveLength(10);
    // All points should be near the start/end
    for (const [lng, lat] of points) {
      expect(lng).toBeGreaterThan(-1);
      expect(lng).toBeLessThan(0);
      expect(lat).toBeGreaterThan(51);
      expect(lat).toBeLessThan(52);
    }
  });

  it("defaults to 64 points when numPoints is omitted", () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [90, 0];
    const points = interpolateGreatCircle(start, end);
    expect(points).toHaveLength(64);
  });

  it("handles antipodal points without throwing", () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [180, 0];
    expect(() => interpolateGreatCircle(start, end, 10)).not.toThrow();
    const points = interpolateGreatCircle(start, end, 10);
    expect(points.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// lookupAirportCoords
// ---------------------------------------------------------------------------
describe("lookupAirportCoords", () => {
  it("returns coordinates for EGLL (Heathrow)", () => {
    const result = lookupAirportCoords("EGLL");
    expect(result).not.toBeNull();
    expect(result!.lng).toBeCloseTo(-0.46, 0);
    expect(result!.lat).toBeCloseTo(51.47, 0);
  });

  it("returns coordinates for KJFK (JFK)", () => {
    const result = lookupAirportCoords("KJFK");
    expect(result).not.toBeNull();
    expect(result!.lng).toBeCloseTo(-73.78, 0);
    expect(result!.lat).toBeCloseTo(40.64, 0);
  });

  it("returns coordinates for RJTT (Tokyo Haneda)", () => {
    const result = lookupAirportCoords("RJTT");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeGreaterThan(35);
    expect(result!.lat).toBeLessThan(36);
  });

  it("returns null for unknown ICAO codes", () => {
    expect(lookupAirportCoords("ZZZZ")).toBeNull();
    expect(lookupAirportCoords("")).toBeNull();
    expect(lookupAirportCoords("FAKE")).toBeNull();
  });

  it("handles case-insensitive lookup", () => {
    const upper = lookupAirportCoords("EGLL");
    const lower = lookupAirportCoords("egll");
    expect(upper).toEqual(lower);
  });
});

// ---------------------------------------------------------------------------
// fetchFlightRoute
// ---------------------------------------------------------------------------
describe("fetchFlightRoute", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns origin and destination from a valid API response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          callsign: "BAW123",
          route: ["EGLL", "KJFK"]
        })
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchFlightRoute("BAW123");
    expect(result).toEqual({ origin: "EGLL", destination: "KJFK" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://opensky-network.org/api/routes?callsign=BAW123",
      expect.objectContaining({ signal: undefined })
    );
  });

  it("passes an AbortSignal when provided", async () => {
    const controller = new AbortController();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          callsign: "BAW123",
          route: ["EGLL", "KJFK"]
        })
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchFlightRoute("BAW123", controller.signal);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("returns null on HTTP 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 })
    );

    const result = await fetchFlightRoute("UNKNOWN");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const result = await fetchFlightRoute("BAW123");
    expect(result).toBeNull();
  });

  it("returns null when API returns empty route array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            callsign: "BAW123",
            route: []
          })
      })
    );

    const result = await fetchFlightRoute("BAW123");
    expect(result).toBeNull();
  });

  it("returns null when API returns only one airport", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            callsign: "BAW123",
            route: ["EGLL"]
          })
      })
    );

    const result = await fetchFlightRoute("BAW123");
    expect(result).toBeNull();
  });

  it("returns null when response JSON is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unexpected: "shape" })
      })
    );

    const result = await fetchFlightRoute("BAW123");
    expect(result).toBeNull();
  });

  it("returns null when abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"))
    );

    const result = await fetchFlightRoute("BAW123", controller.signal);
    expect(result).toBeNull();
  });

  it("uses first and last route entries for multi-leg routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            callsign: "DAL456",
            route: ["KATL", "KORD", "KSFO"]
          })
      })
    );

    const result = await fetchFlightRoute("DAL456");
    expect(result).toEqual({ origin: "KATL", destination: "KSFO" });
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("flight route constants", () => {
  it("exports source and layer IDs", () => {
    expect(FLIGHT_ROUTE_SOURCE).toBe("flight-route");
    expect(FLIGHT_ROUTE_LAYER).toBe("flight-route-line");
  });
});
