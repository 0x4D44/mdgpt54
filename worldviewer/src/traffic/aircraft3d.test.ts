import { describe, expect, it } from "vitest";

import {
  buildRenderableAircraft3dTracks,
  getAircraft3dAltitudeMeters,
  resolveAircraft3dMode,
  selectAircraft3dClass
} from "./aircraft3d";
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

const VIEW_BBOX: Bbox = [-4, 55, -3, 56];

describe("resolveAircraft3dMode", () => {
  it("activates 3D only when zoom, pitch, and visible renderable aircraft thresholds all pass", () => {
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
        zoom: 10.5,
        pitch: 45,
        tracks
      })
    ).toEqual({
      enabled: true,
      visibleRenderableCount: 24
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
        zoom: 11,
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
        zoom: 10.1,
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
        zoom: 10.2,
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
        zoom: 9.99,
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
        zoom: 11,
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
        zoom: 11,
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

  it("falls back to aircraft category when Step 2 identity is missing", () => {
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 6 }))).toBe("wide-body");
    expect(selectAircraft3dClass(makeTrack({ aircraftCategory: 8 }))).toBe("helicopter");
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
});
