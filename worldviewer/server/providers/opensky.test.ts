import { describe, expect, it } from "vitest";
import { bboxToOpenSkyParams, parseOpenSkyStates } from "./opensky";
import type { Bbox } from "../trafficModel";

describe("bboxToOpenSkyParams", () => {
  it("maps canonical bbox [west,south,east,north] to OpenSky query params", () => {
    const bbox: Bbox = [-3.6, 55.8, -3.0, 56.1];
    const params = bboxToOpenSkyParams(bbox);
    expect(params).toEqual({
      lamin: 55.8,
      lomin: -3.6,
      lamax: 56.1,
      lomax: -3.0,
    });
  });
});

describe("parseOpenSkyStates", () => {
  it("returns empty array for null/undefined response", () => {
    expect(parseOpenSkyStates(null)).toEqual([]);
    expect(parseOpenSkyStates(undefined)).toEqual([]);
  });

  it("returns empty array when states is null", () => {
    expect(parseOpenSkyStates({ time: 1234, states: null })).toEqual([]);
  });

  it("parses a valid state vector into a LiveTrack", () => {
    // OpenSky state vector indices:
    // 0: icao24, 1: callsign, 2: origin_country, 3: time_position,
    // 4: last_contact, 5: longitude, 6: latitude, 7: baro_altitude,
    // 8: on_ground, 9: velocity, 10: true_track, 11: vertical_rate,
    // 12: sensors, 13: geo_altitude, 14: squawk, 15: spi, 16: position_source
    const state = [
      "abc123",     // icao24
      "BAW123 ",    // callsign (often padded)
      "United Kingdom",
      1773264000,   // time_position
      1773264000,   // last_contact
      -3.3,         // longitude
      55.9,         // latitude
      10000,        // baro_altitude (meters)
      false,        // on_ground
      250.5,        // velocity (m/s)
      45.2,         // true_track (degrees)
      0,            // vertical_rate
      null,         // sensors
      10050,        // geo_altitude
      null,         // squawk
      false,        // spi
      0,            // position_source
    ];

    const now = Date.now();
    const tracks = parseOpenSkyStates({ time: 1773264000, states: [state] }, now);
    expect(tracks).toHaveLength(1);

    const t = tracks[0];
    expect(t.id).toBe("abc123");
    expect(t.kind).toBe("aircraft");
    expect(t.lng).toBe(-3.3);
    expect(t.lat).toBe(55.9);
    expect(t.heading).toBe(45.2);
    expect(t.altitudeMeters).toBe(10000);
    expect(t.label).toBe("BAW123");
    expect(t.source).toBe("opensky");
    expect(t.updatedAt).toBe(now);
    // velocity m/s → knots: 250.5 * 1.94384 ≈ 486.9
    expect(t.speedKnots).toBeCloseTo(486.9, 0);
  });

  it("handles missing position data gracefully", () => {
    const state = [
      "def456",
      null,         // no callsign
      "Germany",
      null,         // no time_position
      1773264000,
      null,         // no longitude
      null,         // no latitude
      null,         // no altitude
      false,
      null,         // no velocity
      null,         // no track
      null,
      null,
      null,
      null,
      false,
      0,
    ];

    const tracks = parseOpenSkyStates({ time: 1773264000, states: [state] });
    // Should skip entries without position
    expect(tracks).toHaveLength(0);
  });
});
