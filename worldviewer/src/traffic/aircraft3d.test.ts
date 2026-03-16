import { describe, expect, it } from "vitest";

import {
  buildRenderableAircraft3dTracks,
  filterAircraft3dHandoffTracks,
  getAircraft3dAltitudeMeters,
  resolveAircraft3dMode,
  selectAircraft3dClass
} from "./aircraft3d";
import type { RenderableAircraft3dTrack } from "./aircraft3d";
import type { Bbox, LiveTrack } from "./trafficTypes";

function makeTrack(overrides: Partial<LiveTrack> = {}): LiveTrack {
  return {
    id: "abc123",
    kind: "aircraft",
    lng: -3.2,
    lat: 55.9,
    heading: 90,
    speedKnots: 250,
    altitudeMeters: 10000,
    label: "BAW123",
    source: "opensky",
    updatedAt: 1000000,
    ...overrides
  };
}

function makeRenderableTrack(overrides: Partial<RenderableAircraft3dTrack> = {}): RenderableAircraft3dTrack {
  return {
    id: "renderable-1",
    lng: -3.2,
    lat: 55.9,
    heading: 90,
    altitudeMeters: 10000,
    classKey: "narrow-body",
    ...overrides
  };
}

const VIEW_BBOX: Bbox = [-4, 55, -3, 56];

describe("resolveAircraft3dMode", () => {
  it("activates 3D only when the closer zoom, pitch, and visible renderable aircraft thresholds all pass", () => {
    const tracks = Array.from({ length: 24 }, (_, index) =>
      makeTrack({
        id: `ab${index.toString(16).padStart(4, "0")}`,
        lng: -3.9 + index * 0.02,
        lat: 55.5,
        geoAltitudeMeters: 10200
      })
    );

    expect(
      resolveAircraft3dMode(false, {
        bounds: VIEW_BBOX,
        zoom: 13.5,
        pitch: 45,
        tracks
      })
    ).toEqual({
      enabled: true,
      visibleRenderableCount: 24
    });
  });

  it("keeps 2D active below the closer 3D handoff zoom even when pitch and count qualify", () => {
    const tracks = Array.from({ length: 6 }, (_, index) =>
      makeTrack({
        id: `ab${index.toString(16).padStart(4, "0")}`,
        lng: -3.9 + index * 0.02,
        lat: 55.5,
        geoAltitudeMeters: 10200
      })
    );

    expect(
      resolveAircraft3dMode(false, {
        bounds: VIEW_BBOX,
        zoom: 13.49,
        pitch: 55,
        tracks
      })
    ).toEqual({
      enabled: false,
      visibleRenderableCount: 6
    });
  });

  it("does not activate when the visible renderable aircraft count is above the on threshold", () => {
    const tracks = Array.from({ length: 25 }, (_, index) =>
      makeTrack({
        id: `ab${index.toString(16).padStart(4, "0")}`,
        lng: -3.9 + index * 0.02,
        lat: 55.5,
        geoAltitudeMeters: 9800
      })
    );

    expect(
      resolveAircraft3dMode(false, {
        bounds: VIEW_BBOX,
        zoom: 13.5,
        pitch: 55,
        tracks
      })
    ).toEqual({
      enabled: false,
      visibleRenderableCount: 25
    });
  });

  it("keeps 3D enabled inside the hysteresis band", () => {
    const tracks = Array.from({ length: 31 }, (_, index) =>
      makeTrack({
        id: `ab${index.toString(16).padStart(4, "0")}`,
        lng: -3.95 + index * 0.02,
        lat: 55.6,
        altitudeMeters: 11000
      })
    );

    expect(
      resolveAircraft3dMode(true, {
        bounds: VIEW_BBOX,
        zoom: 13.1,
        pitch: 36,
        tracks
      })
    ).toEqual({
      enabled: true,
      visibleRenderableCount: 31
    });
  });

  it("drops back to 2D when any off threshold is crossed", () => {
    const tracks = Array.from({ length: 32 }, (_, index) =>
      makeTrack({
        id: `ab${index.toString(16).padStart(4, "0")}`,
        lng: -3.95 + index * 0.02,
        lat: 55.6,
        altitudeMeters: 11000
      })
    );

    expect(
      resolveAircraft3dMode(true, {
        bounds: VIEW_BBOX,
        zoom: 13.2,
        pitch: 40,
        tracks
      })
    ).toEqual({
      enabled: false,
      visibleRenderableCount: 32
    });

    expect(
      resolveAircraft3dMode(true, {
        bounds: VIEW_BBOX,
        zoom: 12.99,
        pitch: 50,
        tracks: [makeTrack({ geoAltitudeMeters: 10000 })]
      })
    ).toEqual({
      enabled: false,
      visibleRenderableCount: 1
    });

    expect(
      resolveAircraft3dMode(true, {
        bounds: VIEW_BBOX,
        zoom: 13.2,
        pitch: 34.99,
        tracks: [makeTrack({ geoAltitudeMeters: 10000 })]
      })
    ).toEqual({
      enabled: false,
      visibleRenderableCount: 1
    });
  });

  it("counts only raw aircraft tracks in bounds that can actually render in 3D", () => {
    const tracks: LiveTrack[] = [
      makeTrack({ id: "render-1", geoAltitudeMeters: 10000 }),
      makeTrack({ id: "render-2", altitudeMeters: 9000, geoAltitudeMeters: null }),
      makeTrack({ id: "grounded", onGround: true, geoAltitudeMeters: 50 }),
      makeTrack({ id: "flat", altitudeMeters: null, geoAltitudeMeters: null }),
      makeTrack({ id: "outside", lng: -10, geoAltitudeMeters: 10000 }),
      {
        ...makeTrack({ id: "ship-1", geoAltitudeMeters: 10000 }),
        kind: "ship"
      }
    ];

    expect(
      resolveAircraft3dMode(false, {
        bounds: VIEW_BBOX,
        zoom: 14,
        pitch: 50,
        tracks
      })
    ).toEqual({
      enabled: true,
      visibleRenderableCount: 2
    });
  });
});

describe("getAircraft3dAltitudeMeters", () => {
  it("prefers geometric altitude when available", () => {
    expect(getAircraft3dAltitudeMeters(makeTrack({ altitudeMeters: 10000, geoAltitudeMeters: 10120 }))).toBe(10120);
  });

  it("falls back to barometric altitude when geometry is missing", () => {
    expect(getAircraft3dAltitudeMeters(makeTrack({ altitudeMeters: 10000, geoAltitudeMeters: null }))).toBe(10000);
  });

  it("suppresses on-ground aircraft from the 3D path", () => {
    expect(getAircraft3dAltitudeMeters(makeTrack({ onGround: true, altitudeMeters: 30, geoAltitudeMeters: 40 }))).toBeNull();
  });
});

describe("selectAircraft3dClass", () => {
  it("uses renderModelKey when it identifies a narrow-body family", () => {
    expect(selectAircraft3dClass(makeTrack({ renderModelKey: "boeing-737-family" }))).toBe("narrow-body");
  });

  it("uses renderModelKey when it identifies a wide-body family", () => {
    expect(selectAircraft3dClass(makeTrack({ renderModelKey: "boeing-787-family" }))).toBe("wide-body");
  });

  it("classifies wide-body aircraft by type-code prefix", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "A330" }))).toBe("wide-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "B77W" }))).toBe("wide-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "A380" }))).toBe("wide-body");
  });

  it("classifies narrow-body aircraft by type-code prefix", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "A320" }))).toBe("narrow-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "B738" }))).toBe("narrow-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "A21N" }))).toBe("narrow-body");
  });

  it("falls back to type-code heuristics for regional jets, bizjets, and props", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "CRJ9" }))).toBe("regional-jet");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "C56X" }))).toBe("bizjet");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "C25B" }))).toBe("bizjet");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "AT76" }))).toBe("prop");
  });

  it("normalizes lowercase type codes before prefix matching", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "c56x" }))).toBe("bizjet");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "ec35" }))).toBe("helicopter");
  });

  it("does not let broad citation prefixes swallow props and military transports", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "C208" }))).toBe("prop");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "C206" }))).toBe("prop");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "C402" }))).toBe("prop");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "C130" }))).toBe("prop");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "C17" }))).not.toBe("bizjet");
  });

  it("uses helicopter type-code prefixes before descriptor and category fallbacks", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "R44" }))).toBe("helicopter");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "EC35" }))).toBe("helicopter");
    expect(selectAircraft3dClass(makeTrack({ aircraftTypeCode: "B429" }))).toBe("helicopter");
  });

  it("classifies by manufacturer/model keywords when no type code matches", () => {
    expect(selectAircraft3dClass(makeTrack({ manufacturer: "Bell", model: "Helicopter 407" }))).toBe("helicopter");
    expect(selectAircraft3dClass(makeTrack({ manufacturer: "Boeing", model: "787 Dreamliner" }))).toBe("wide-body");
    expect(selectAircraft3dClass(makeTrack({ manufacturer: "Airbus", model: "A320neo" }))).toBe("narrow-body");
    expect(selectAircraft3dClass(makeTrack({ manufacturer: "Embraer", model: "Embraer 175" }))).toBe("regional-jet");
    expect(selectAircraft3dClass(makeTrack({ manufacturer: "Cessna", model: "Citation CJ3" }))).toBe("bizjet");
    expect(selectAircraft3dClass(makeTrack({ manufacturer: "ATR", model: "ATR 72-600" }))).toBe("prop");
  });

  it("falls back to aircraft category when Step 2 identity is missing", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 5 }))).toBe("wide-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 6 }))).toBe("wide-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 4 }))).toBe("narrow-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 7 }))).toBe("bizjet");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 8 }))).toBe("helicopter");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 2 }))).toBe("prop");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 10 }))).toBe("prop");
  });

  it("falls through descriptor keywords to category when manufacturer/model has no recognized keyword", () => {
    expect(
      selectAircraft3dClass(makeTrack({ manufacturer: "Unknown Mfg", model: "Exotic X99", aircraftCategory: 7 }))
    ).toBe("bizjet");
  });

  it("defaults to narrow-body when no type code, descriptor, or category matches", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: null }))).toBe("narrow-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 99 }))).toBe("narrow-body");
  });
});

describe("buildRenderableAircraft3dTracks", () => {
  it("returns only visible aircraft with a chosen altitude and selected class", () => {
    expect(
      buildRenderableAircraft3dTracks(
        [
          makeTrack({ id: "b738", renderModelKey: "boeing-737-family", geoAltitudeMeters: 10500 }),
          makeTrack({ id: "ground", renderModelKey: "boeing-737-family", geoAltitudeMeters: 20, onGround: true }),
          makeTrack({ id: "outside", renderModelKey: "boeing-737-family", lng: -12, geoAltitudeMeters: 10500 })
        ],
        VIEW_BBOX
      )
    ).toEqual([
      {
        id: "b738",
        lng: -3.2,
        lat: 55.9,
        heading: 90,
        altitudeMeters: 10500,
        classKey: "narrow-body"
      }
    ]);
  });

  it("excludes aircraft whose latitude falls outside bounds", () => {
    expect(
      buildRenderableAircraft3dTracks(
        [makeTrack({ id: "too-south", lat: 54.9, geoAltitudeMeters: 10000 })],
        VIEW_BBOX
      )
    ).toEqual([]);
  });

  it("includes aircraft inside an antimeridian-wrapping bounding box", () => {
    const antimeridianBbox: Bbox = [170, -10, -170, 10];

    const result = buildRenderableAircraft3dTracks(
      [
        makeTrack({ id: "east-side", lng: 175, lat: 0, geoAltitudeMeters: 10000 }),
        makeTrack({ id: "west-side", lng: -175, lat: 0, geoAltitudeMeters: 10000 }),
        makeTrack({ id: "excluded", lng: 0, lat: 0, geoAltitudeMeters: 10000 })
      ],
      antimeridianBbox
    );

    expect(result.map((t) => t.id)).toEqual(["east-side", "west-side"]);
  });

  it("excludes tracks with no altitude data", () => {
    expect(
      buildRenderableAircraft3dTracks(
        [makeTrack({ id: "no-alt", altitudeMeters: null, geoAltitudeMeters: null })],
        VIEW_BBOX
      )
    ).toEqual([]);
  });

  it("excludes non-aircraft tracks", () => {
    expect(
      buildRenderableAircraft3dTracks(
        [{ ...makeTrack({ id: "ship", geoAltitudeMeters: 10000 }), kind: "ship" as const }],
        VIEW_BBOX
      )
    ).toEqual([]);
  });
});

describe("filterAircraft3dHandoffTracks", () => {
  it("waits until the 3D replacement is at least as large as the capped 2D symbol", () => {
    expect(
      filterAircraft3dHandoffTracks(
        [
          makeRenderableTrack({ id: "equator-narrow", lat: 0, classKey: "narrow-body" }),
          makeRenderableTrack({ id: "north-narrow", lat: 55.9, classKey: "narrow-body" }),
          makeRenderableTrack({ id: "north-bizjet", lat: 55.9, classKey: "bizjet" }),
          makeRenderableTrack({ id: "equator-wide", lat: 0, classKey: "wide-body" }),
          makeRenderableTrack({ id: "north-wide", lat: 55.9, classKey: "wide-body" })
        ],
        13.5
      ).map((track) => track.id)
    ).toEqual(["north-wide"]);

    expect(
      filterAircraft3dHandoffTracks([makeRenderableTrack({ id: "north-narrow", lat: 55.9, classKey: "narrow-body" })], 14).map(
        (track) => track.id
      )
    ).toEqual(["north-narrow"]);
  });
});
