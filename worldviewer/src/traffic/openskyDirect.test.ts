import { describe, expect, it } from "vitest";

import { openSkyUrl, parseOpenSkyStates } from "./openskyDirect";
import type { Bbox } from "./trafficTypes";

describe("openSkyUrl", () => {
  it("maps canonical bbox order to OpenSky query params", () => {
    const bbox: Bbox = [-3.6, 55.8, -3.0, 56.1];
    expect(openSkyUrl(bbox)).toBe(
      "https://opensky-network.org/api/states/all?lamin=55.8&lomin=-3.6&lamax=56.1&lomax=-3"
    );
  });
});

describe("parseOpenSkyStates", () => {
  it("returns an empty array for missing state data", () => {
    expect(parseOpenSkyStates(null)).toEqual([]);
    expect(parseOpenSkyStates({})).toEqual([]);
    expect(parseOpenSkyStates({ states: null })).toEqual([]);
  });

  it("parses valid state vectors into aircraft tracks", () => {
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
            45.2
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
      label: "BAW123",
      source: "opensky",
      updatedAt: now
    });
    expect(tracks[0].speedKnots).toBeCloseTo(486.9, 0);
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
});
