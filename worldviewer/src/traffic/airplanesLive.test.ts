import { describe, expect, it } from "vitest";

import { airplanesLiveUrl, parseAirplanesLive } from "./airplanesLive";
import type { Bbox } from "./trafficTypes";

describe("airplanesLiveUrl", () => {
  it("maps a bbox to a centre + radius point query", () => {
    const bbox: Bbox = [-1, 51, 1, 52];
    const url = airplanesLiveUrl(bbox);
    expect(url).toMatch(/^https:\/\/api\.airplanes\.live\/v2\/point\/51\.50000\/0\.00000\/\d+$/);
  });

  it("caps the radius at 250 nm", () => {
    const bbox: Bbox = [-60, 0, 60, 60];
    const radius = Number(airplanesLiveUrl(bbox).split("/").pop());
    expect(radius).toBeLessThanOrEqual(250);
    expect(radius).toBeGreaterThan(0);
  });
});

describe("parseAirplanesLive", () => {
  const now = 1781469513000;

  it("maps an airborne aircraft (feet->metres, knots, type, category)", () => {
    const tracks = parseAirplanesLive(
      {
        ac: [
          {
            hex: "40766D",
            flight: "EXS72YU ",
            r: "G-DRTN",
            t: "B738",
            category: "A3",
            lat: 51.55,
            lon: -0.25,
            track: 25.6,
            gs: 296.1,
            alt_baro: 10000,
            alt_geom: 10500
          }
        ]
      },
      now
    );

    expect(tracks).toHaveLength(1);
    const t = tracks[0];
    expect(t.id).toBe("40766d"); // lowercased
    expect(t.callsign).toBe("EXS72YU");
    expect(t.lng).toBe(-0.25);
    expect(t.lat).toBe(51.55);
    expect(t.heading).toBe(25.6);
    expect(t.speedKnots).toBe(296.1); // already knots, not converted
    expect(t.altitudeMeters).toBeCloseTo(3048, 0); // 10000 ft -> m
    expect(t.geoAltitudeMeters).toBeCloseTo(3200.4, 1);
    expect(t.aircraftTypeCode).toBe("B738");
    expect(t.registration).toBe("G-DRTN");
    expect(t.aircraftCategory).toBe(4); // A3 (large) -> 4 (narrow-body band)
    expect(t.onGround).toBe(false);
    expect(t.source).toBe("airplaneslive");
  });

  it("treats alt_baro 'ground' as on-ground with no barometric altitude", () => {
    const tracks = parseAirplanesLive({
      ac: [{ hex: "abc123", lat: 51, lon: 0, gs: 12, alt_baro: "ground" }]
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0].onGround).toBe(true);
    expect(tracks[0].altitudeMeters).toBeNull();
  });

  it("drops entries without a hex or without a finite position", () => {
    const tracks = parseAirplanesLive({
      ac: [
        { flight: "NOHEX", lat: 51, lon: 0 }, // no hex
        { hex: "deadbeef", lat: null, lon: 0 }, // bad lat
        { hex: "cafe01", lat: 50, lon: 0.1 } // good
      ]
    });
    expect(tracks.map((t) => t.id)).toEqual(["cafe01"]);
  });

  it("returns [] for malformed payloads", () => {
    expect(parseAirplanesLive(null)).toEqual([]);
    expect(parseAirplanesLive({})).toEqual([]);
    expect(parseAirplanesLive({ ac: "nope" })).toEqual([]);
  });
});
