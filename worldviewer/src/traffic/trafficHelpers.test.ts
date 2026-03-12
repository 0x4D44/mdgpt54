import { describe, expect, it, vi } from "vitest";

import {
  MIN_LIVE_TRAFFIC_ZOOM,
  STALE_THRESHOLD_MS,
  bboxFromBounds,
  buildAircraftPopupIdentity,
  debounce,
  deriveFlightCode,
  formatAge,
  formatAircraftAltitude,
  formatAltitude,
  formatSpeed,
  getAircraftCategoryLabel,
  getAircraftVisualCategory,
  getTrafficClientHint,
  isStaticTrafficHost,
  isTrackStale,
  parseSnapshot,
  resolveEffectiveTrafficLayers,
  trackOpacity,
  tracksToGeoJSON
} from "./trafficHelpers";
import type { LiveTrack, SnapshotMessage } from "./trafficTypes";

function makeTrack(overrides: Partial<LiveTrack> = {}): LiveTrack {
  return {
    id: "abc123",
    kind: "aircraft",
    lng: -3.2,
    lat: 55.9,
    heading: 90,
    speedKnots: 250,
    altitudeMeters: 10000,
    label: "RYR123",
    source: "opensky",
    updatedAt: 1000000,
    ...overrides
  };
}

describe("bboxFromBounds", () => {
  it("extracts a canonical [west, south, east, north] tuple", () => {
    const bounds = {
      getWest: () => -3.6,
      getSouth: () => 55.8,
      getEast: () => -3.0,
      getNorth: () => 56.1
    };
    expect(bboxFromBounds(bounds)).toEqual([-3.6, 55.8, -3.0, 56.1]);
  });
});

describe("isTrackStale", () => {
  it("returns false for a fresh track", () => {
    const track = makeTrack({ updatedAt: 1000 });
    expect(isTrackStale(track, 1000 + STALE_THRESHOLD_MS - 1)).toBe(false);
  });

  it("returns false at exactly the threshold boundary", () => {
    const track = makeTrack({ updatedAt: 1000 });
    expect(isTrackStale(track, 1000 + STALE_THRESHOLD_MS)).toBe(false);
  });

  it("returns true when past the stale threshold", () => {
    const track = makeTrack({ updatedAt: 1000 });
    expect(isTrackStale(track, 1000 + STALE_THRESHOLD_MS + 1)).toBe(true);
  });
});

describe("trackOpacity", () => {
  it("returns 1.0 for a brand-new track", () => {
    const track = makeTrack({ updatedAt: 5000 });
    expect(trackOpacity(track, 5000)).toBe(1);
  });

  it("returns a value between 0.3 and 1.0 for an aging track", () => {
    const track = makeTrack({ updatedAt: 0 });
    const opacity = trackOpacity(track, STALE_THRESHOLD_MS);
    expect(opacity).toBeGreaterThan(0.3);
    expect(opacity).toBeLessThan(1);
  });

  it("returns 0.3 for a very old track", () => {
    const track = makeTrack({ updatedAt: 0 });
    expect(trackOpacity(track, STALE_THRESHOLD_MS * 10)).toBe(0.3);
  });
});

describe("tracksToGeoJSON", () => {
  it("returns an empty FeatureCollection for no tracks", () => {
    const result = tracksToGeoJSON([], Date.now());
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(0);
  });

  it("converts tracks to Point features with correct properties", () => {
    const now = 2000;
    const track = makeTrack({
      updatedAt: now,
      lng: 10.5,
      lat: 48.2,
      onGround: false,
      aircraftTypeCode: "B738",
      registration: "N123AB",
      manufacturer: "Boeing",
      model: "737-800",
      callsign: "BAW123",
      flightCode: "BAW 123",
      aircraftCategory: 8,
      geoAltitudeMeters: 10120,
      renderModelKey: "boeing-737-family"
    });
    const result = tracksToGeoJSON([track], now);
    expect(result.features).toHaveLength(1);

    const feature = result.features[0];
    expect(feature.geometry).toEqual({ type: "Point", coordinates: [10.5, 48.2] });
    expect(feature.properties?.id).toBe("abc123");
    expect(feature.properties?.kind).toBe("aircraft");
    expect(feature.properties?.heading).toBe(90);
    expect(feature.properties?.opacity).toBe(1);
    expect(feature.properties?.onGround).toBe(false);
    expect(feature.properties?.callsign).toBe("BAW123");
    expect(feature.properties?.flightCode).toBe("BAW 123");
    expect(feature.properties?.aircraftCategory).toBe(8);
    expect(feature.properties?.geoAltitudeMeters).toBe(10120);
    expect(feature.properties?.aircraftTypeCode).toBe("B738");
    expect(feature.properties?.registration).toBe("N123AB");
    expect(feature.properties?.manufacturer).toBe("Boeing");
    expect(feature.properties?.model).toBe("737-800");
    expect(feature.properties?.renderModelKey).toBe("boeing-737-family");
    expect(feature.properties?.aircraftVisualCategory).toBe("rotor");
  });

  it("hides only the aircraft that are actively replaced by the 3D layer", () => {
    const now = 2000;
    const visibleTrack = makeTrack({ id: "visible-3d", updatedAt: now });
    const visible2dTrack = makeTrack({ id: "visible-2d", updatedAt: now, lng: 11 });

    const result = tracksToGeoJSON([visibleTrack, visible2dTrack], now, new Set(["visible-3d"]));

    expect(result.features[0].properties?.opacity).toBe(0);
    expect(result.features[1].properties?.opacity).toBe(1);
  });
});

describe("formatAge", () => {
  it("formats seconds for recent updates", () => {
    expect(formatAge(1000, 1000)).toBe("0s ago");
    expect(formatAge(1000, 6000)).toBe("5s ago");
    expect(formatAge(1000, 60000)).toBe("59s ago");
  });

  it("switches to minutes after 60 seconds", () => {
    expect(formatAge(0, 61000)).toBe("1m ago");
    expect(formatAge(0, 300000)).toBe("5m ago");
  });

  it("does not show negative ages", () => {
    expect(formatAge(5000, 1000)).toBe("0s ago");
  });
});

describe("formatSpeed", () => {
  it("returns null for null input", () => {
    expect(formatSpeed(null)).toBeNull();
  });

  it("formats knots with one decimal", () => {
    expect(formatSpeed(250)).toBe("250.0 kn");
    expect(formatSpeed(12.34)).toBe("12.3 kn");
  });
});

describe("formatAltitude", () => {
  it("returns null for null input", () => {
    expect(formatAltitude(null)).toBeNull();
  });

  it("formats altitude as rounded meters", () => {
    expect(formatAltitude(10668)).toBe("10668 m");
    expect(formatAltitude(99.7)).toBe("100 m");
  });
});

describe("parseSnapshot", () => {
  const valid: SnapshotMessage = {
    type: "snapshot",
    aircraft: [],
    ships: [],
    serverTime: 123456,
    status: {
      aircraft: { code: "ok", message: null },
      ships: { code: "ok", message: null }
    }
  };

  it("accepts a valid snapshot message", () => {
    expect(parseSnapshot(valid)).toEqual(valid);
  });

  it("rejects non-objects", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("string")).toBeNull();
    expect(parseSnapshot(42)).toBeNull();
  });

  it("rejects messages with wrong type", () => {
    expect(parseSnapshot({ ...valid, type: "subscribe" })).toBeNull();
  });

  it("rejects messages missing required fields", () => {
    expect(parseSnapshot({ type: "snapshot", aircraft: [] })).toBeNull();
    expect(parseSnapshot({ type: "snapshot", aircraft: [], ships: [], serverTime: "nope", status: {} })).toBeNull();
  });
});

describe("resolveEffectiveTrafficLayers", () => {
  it("passes requested layers through above the minimum zoom", () => {
    expect(
      resolveEffectiveTrafficLayers({ aircraftEnabled: true, shipsEnabled: false }, MIN_LIVE_TRAFFIC_ZOOM)
    ).toEqual({ aircraftEnabled: true, shipsEnabled: false });
  });

  it("suppresses all layers below the minimum zoom", () => {
    expect(
      resolveEffectiveTrafficLayers(
        { aircraftEnabled: true, shipsEnabled: true },
        MIN_LIVE_TRAFFIC_ZOOM - 0.1
      )
    ).toEqual({ aircraftEnabled: false, shipsEnabled: false });
  });
});

describe("isStaticTrafficHost", () => {
  it("detects GitHub Pages hosts", () => {
    expect(isStaticTrafficHost("0x4d44.github.io")).toBe(true);
  });

  it("does not treat localhost as a static host", () => {
    expect(isStaticTrafficHost("localhost")).toBe(false);
  });
});

describe("formatAircraftAltitude", () => {
  it("prefers geometric altitude when it is available", () => {
    expect(formatAircraftAltitude({ altitudeMeters: 10000, geoAltitudeMeters: 10120 })).toBe("10120 m");
  });

  it("falls back to barometric altitude when geometry is missing", () => {
    expect(formatAircraftAltitude({ altitudeMeters: 10000, geoAltitudeMeters: null })).toBe("10000 m");
  });
});

describe("deriveFlightCode", () => {
  it("formats matching callsigns using the exact HLD regex", () => {
    expect(deriveFlightCode("BAW123")).toBe("BAW 123");
    expect(deriveFlightCode("DAL7A")).toBe("DAL 7A");
    expect(deriveFlightCode(" BAW123 ")).toBe("BAW 123");
  });

  it("rejects callsigns outside the exact HLD regex", () => {
    expect(deriveFlightCode("baw123")).toBeNull();
    expect(deriveFlightCode("BA123")).toBeNull();
    expect(deriveFlightCode("BAW12345")).toBeNull();
    expect(deriveFlightCode("BAW 123")).toBeNull();
  });
});

describe("getAircraftVisualCategory", () => {
  it("maps Step 1 categories into silhouette groups", () => {
    expect(getAircraftVisualCategory(2)).toBe("light");
    expect(getAircraftVisualCategory(4)).toBe("transport");
    expect(getAircraftVisualCategory(7)).toBe("fast");
    expect(getAircraftVisualCategory(8)).toBe("rotor");
    expect(getAircraftVisualCategory(10)).toBe("glider");
  });

  it("falls back to the generic silhouette for unknown or missing categories", () => {
    expect(getAircraftVisualCategory(0)).toBe("generic");
    expect(getAircraftVisualCategory(1)).toBe("generic");
    expect(getAircraftVisualCategory(null)).toBe("generic");
    expect(getAircraftVisualCategory(undefined)).toBe("generic");
    expect(getAircraftVisualCategory(99)).toBe("generic");
  });
});

describe("getAircraftCategoryLabel", () => {
  it("suppresses sentinel categories that should not appear in popups", () => {
    expect(getAircraftCategoryLabel(0)).toBeNull();
    expect(getAircraftCategoryLabel(1)).toBeNull();
  });

  it("returns labels for displayable categories", () => {
    expect(getAircraftCategoryLabel(6)).toBe("Heavy");
  });
});

describe("buildAircraftPopupIdentity", () => {
  it("orders Step 2 aircraft identity as flight code, raw callsign, registration, model, type, then category", () => {
    expect(
      buildAircraftPopupIdentity({
        id: "abc123",
        label: "BAW 123",
        callsign: "BAW123",
        flightCode: "BAW 123",
        registration: "N123AB",
        manufacturer: "Boeing",
        model: "737-800",
        aircraftTypeCode: "B738",
        aircraftCategory: 6
      })
    ).toEqual({
      title: "BAW 123",
      rows: ["Callsign BAW123", "Registration N123AB", "Boeing 737-800", "Type B738", "Category Heavy"]
    });
  });

  it("falls back to the raw callsign without duplicating it", () => {
    expect(
      buildAircraftPopupIdentity({
        id: "abc123",
        label: "N123AB",
        callsign: "N123AB",
        flightCode: null,
        registration: "G-ABCD",
        aircraftCategory: 8
      })
    ).toEqual({
      title: "N123AB",
      rows: ["Registration G-ABCD", "Category Rotorcraft"]
    });
  });

  it("omits category rows for sentinel category values", () => {
    expect(
      buildAircraftPopupIdentity({
        id: "abc123",
        label: "BAW 123",
        callsign: "BAW123",
        flightCode: "BAW 123",
        aircraftCategory: 0
      })
    ).toEqual({
      title: "BAW 123",
      rows: ["Callsign BAW123"]
    });

    expect(
      buildAircraftPopupIdentity({
        id: "abc123",
        label: "BAW 123",
        callsign: "BAW123",
        flightCode: "BAW 123",
        aircraftCategory: 1
      })
    ).toEqual({
      title: "BAW 123",
      rows: ["Callsign BAW123"]
    });
  });
});

describe("getTrafficClientHint", () => {
  it("returns null when no traffic layers are requested", () => {
    expect(getTrafficClientHint({ aircraftEnabled: false, shipsEnabled: false }, 1, "localhost")).toBeNull();
  });

  it("returns null when zoom is high enough", () => {
    expect(getTrafficClientHint({ aircraftEnabled: true, shipsEnabled: true }, MIN_LIVE_TRAFFIC_ZOOM, "localhost")).toBeNull();
  });

  it("returns a hint below the minimum zoom when traffic is enabled", () => {
    expect(getTrafficClientHint({ aircraftEnabled: true, shipsEnabled: false }, MIN_LIVE_TRAFFIC_ZOOM - 0.5, "localhost")).toBe(
      "Zoom in past 5 to activate live traffic."
    );
  });

  it("returns the same zoom hint on static hosts because aircraft traffic stays browser-side", () => {
    expect(
      getTrafficClientHint({ aircraftEnabled: true, shipsEnabled: true }, MIN_LIVE_TRAFFIC_ZOOM - 0.5, "0x4d44.github.io")
    ).toBe("Zoom in past 5 to activate live traffic.");
  });
});

describe("debounce", () => {
  it("delays invocation until the timer expires", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("resets the timer on subsequent calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced();
    vi.advanceTimersByTime(200);
    debounced();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
