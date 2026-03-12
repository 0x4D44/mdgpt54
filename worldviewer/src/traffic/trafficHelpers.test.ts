import { describe, expect, it, vi } from "vitest";

import {
  MIN_LIVE_TRAFFIC_ZOOM,
  STALE_THRESHOLD_MS,
  bboxFromBounds,
  debounce,
  formatAge,
  formatAltitude,
  formatSpeed,
  getLowZoomTrafficHint,
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
    const track = makeTrack({ updatedAt: now, lng: 10.5, lat: 48.2 });
    const result = tracksToGeoJSON([track], now);
    expect(result.features).toHaveLength(1);

    const feature = result.features[0];
    expect(feature.geometry).toEqual({ type: "Point", coordinates: [10.5, 48.2] });
    expect(feature.properties?.id).toBe("abc123");
    expect(feature.properties?.kind).toBe("aircraft");
    expect(feature.properties?.heading).toBe(90);
    expect(feature.properties?.opacity).toBe(1);
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

describe("getLowZoomTrafficHint", () => {
  it("returns null when no traffic layers are requested", () => {
    expect(getLowZoomTrafficHint({ aircraftEnabled: false, shipsEnabled: false }, 1)).toBeNull();
  });

  it("returns null when zoom is high enough", () => {
    expect(getLowZoomTrafficHint({ aircraftEnabled: true, shipsEnabled: true }, MIN_LIVE_TRAFFIC_ZOOM)).toBeNull();
  });

  it("returns a hint below the minimum zoom when traffic is enabled", () => {
    expect(getLowZoomTrafficHint({ aircraftEnabled: true, shipsEnabled: false }, MIN_LIVE_TRAFFIC_ZOOM - 0.5)).toBe(
      "Zoom in past 5 to activate live traffic."
    );
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
