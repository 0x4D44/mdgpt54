import { describe, expect, it } from "vitest";

import { openSkyUrl, parseOpenSkyStates } from "./openskyDirect";
import type { Bbox } from "./trafficTypes";

describe("openSkyUrl", () => {
  it("maps canonical bbox order to OpenSky query params", () => {
    const bbox: Bbox = [-3.6, 55.8, -3.0, 56.1];
    expect(openSkyUrl(bbox)).toBe(
      "https://opensky-network.org/api/states/all?lamin=55.8&lomin=-3.6&lamax=56.1&lomax=-3&extended=1"
    );
  });
});

describe("parseOpenSkyStates", () => {
  it("returns an empty array for missing state data", () => {
    expect(parseOpenSkyStates(null)).toEqual([]);
    expect(parseOpenSkyStates({})).toEqual([]);
    expect(parseOpenSkyStates({ states: null })).toEqual([]);
  });

  it("parses the Step 1 OpenSky fields from extended state vectors", () => {
    const now = 1773360000000;
    const tracks = parseOpenSkyStates(
      {
        states: [
          [
            "abc123",
            "BAW123 ",
            "United Kingdom",
            1773360000,
            1773360000,
            -3.3,
            55.9,
            10000,
            false,
            250.5,
            45.2,
            null,
            null,
            10100,
            null,
            null,
            null,
            6
          ]
        ]
      },
      now
    );

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: "abc123",
      kind: "aircraft",
      lng: -3.3,
      lat: 55.9,
      heading: 45.2,
      altitudeMeters: 10000,
      label: "BAW 123",
      source: "opensky",
      updatedAt: now,
      onGround: false,
      callsign: "BAW123",
      flightCode: "BAW 123",
      aircraftCategory: 6,
      geoAltitudeMeters: 10100
    });
    expect(tracks[0].speedKnots).toBeCloseTo(486.9, 0);
  });

  it("only derives flight codes when the callsign matches the HLD regex", () => {
    const now = 1773360000000;
    const tracks = parseOpenSkyStates(
      {
        states: [
          [
            "abc123",
            "N123AB ",
            "United States",
            1773360000,
            1773360000,
            -3.3,
            55.9,
            10000,
            false,
            250.5,
            45.2,
            null,
            null,
            10100,
            null,
            null,
            null,
            2
          ]
        ]
      },
      now
    );

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      onGround: false,
      callsign: "N123AB",
      flightCode: null,
      label: "N123AB",
      aircraftCategory: 2
    });
  });

  it("parses the OpenSky on-ground state so grounded aircraft stay on the 2D path", () => {
    const tracks = parseOpenSkyStates({
      states: [
        [
          "abc123",
          "BAW123 ",
          "United Kingdom",
          1773360000,
          1773360000,
          -3.3,
          55.9,
          32,
          true,
          0,
          180,
          null,
          null,
          38,
          null,
          null,
          null,
          6
        ]
      ]
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      onGround: true,
      altitudeMeters: 32,
      geoAltitudeMeters: 38
    });
  });

  it("skips entries without a valid position", () => {
    const tracks = parseOpenSkyStates({
      states: [
        ["bad-1", null, "Germany", null, 1773360000, null, null, null, false, null, null],
        ["bad-2", null, "France", null, 1773360000, 2.35, null, null, false, null, null]
      ]
    });

    expect(tracks).toEqual([]);
  });

  it("skips non-array state entries", () => {
    const tracks = parseOpenSkyStates({
      states: ["not-an-array", null, 42]
    });

    expect(tracks).toEqual([]);
  });

  it("returns null callsign when the callsign field is not a string", () => {
    const now = 1773360000000;
    const tracks = parseOpenSkyStates(
      {
        states: [
          [
            "abc123", null, "Country", 1773360000, 1773360000,
            -3.3, 55.9, 10000, false, 250.5, 45.2,
            null, null, 10100, null, null, null, 6
          ]
        ]
      },
      now
    );

    expect(tracks).toHaveLength(1);
    expect(tracks[0].callsign).toBeNull();
    expect(tracks[0].flightCode).toBeNull();
    expect(tracks[0].label).toBeNull();
  });
});
