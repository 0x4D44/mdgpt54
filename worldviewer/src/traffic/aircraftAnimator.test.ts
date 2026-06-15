import { describe, expect, it } from "vitest";

import { MAX_EXTRAPOLATION_MS, destinationPoint, extrapolateTrack, extrapolateTracks } from "./aircraftAnimator";
import type { LiveTrack } from "./trafficTypes";

const KNOTS_TO_M_PER_S = 0.514444;

function makeTrack(overrides: Partial<LiveTrack> = {}): LiveTrack {
  return {
    id: "test",
    kind: "aircraft",
    lng: 0,
    lat: 0,
    heading: 90,
    speedKnots: 600,
    altitudeMeters: 10000,
    label: null,
    source: "airplaneslive",
    updatedAt: 0,
    onGround: false,
    ...overrides
  };
}

/** Haversine distance in metres between two lon/lat points. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

describe("destinationPoint", () => {
  it("moves east along the equator without changing latitude", () => {
    const { lat, lng } = destinationPoint(0, 0, 90, 100_000);
    expect(lat).toBeCloseTo(0, 6);
    expect(lng).toBeGreaterThan(0);
  });

  it("moves north when bearing is 0", () => {
    const { lat, lng } = destinationPoint(0, 0, 0, 111_320);
    expect(lat).toBeGreaterThan(0);
    expect(lng).toBeCloseTo(0, 6);
    // ~1 degree of latitude per 111.32 km
    expect(lat).toBeCloseTo(1, 1);
  });
});

describe("extrapolateTrack", () => {
  it("moves a fast eastbound track east by the expected distance after 60s", () => {
    const track = makeTrack({ lat: 0, lng: 0, heading: 90, speedKnots: 600, onGround: false, updatedAt: 0 });
    const moved = extrapolateTrack(track, 60_000, 60_000);

    expect(moved.lng).toBeGreaterThan(track.lng);
    expect(moved.lat).toBeCloseTo(0, 4);

    const expectedMeters = 600 * KNOTS_TO_M_PER_S * 60; // ~18520 m
    const actualMeters = haversineMeters(track.lat, track.lng, moved.lat, moved.lng);
    expect(actualMeters).toBeCloseTo(expectedMeters, 0);
  });

  it("leaves all non-position fields identical", () => {
    const track = makeTrack({ speedKnots: 600 });
    const moved = extrapolateTrack(track, 10_000, 60_000);
    expect(moved.id).toBe(track.id);
    expect(moved.heading).toBe(track.heading);
    expect(moved.speedKnots).toBe(track.speedKnots);
    expect(moved.altitudeMeters).toBe(track.altitudeMeters);
    expect(moved.updatedAt).toBe(track.updatedAt);
  });

  it("returns the track unchanged when on the ground", () => {
    const track = makeTrack({ onGround: true });
    expect(extrapolateTrack(track, 60_000, 60_000)).toBe(track);
  });

  it("returns the track unchanged when heading is null", () => {
    const track = makeTrack({ heading: null });
    expect(extrapolateTrack(track, 60_000, 60_000)).toBe(track);
  });

  it("returns the track unchanged when speed is null or non-positive", () => {
    const nullSpeed = makeTrack({ speedKnots: null });
    expect(extrapolateTrack(nullSpeed, 60_000, 60_000)).toBe(nullSpeed);
    const zero = makeTrack({ speedKnots: 0 });
    expect(extrapolateTrack(zero, 60_000, 60_000)).toBe(zero);
  });

  it("clamps elapsed time at maxExtrapolationMs", () => {
    const track = makeTrack({ lat: 0, lng: 0, heading: 90, speedKnots: 600, onGround: false });
    const clamped = extrapolateTrack(track, 1_000_000, 30_000);
    const atCap = extrapolateTrack(track, 30_000, 30_000);
    expect(clamped.lng).toBeCloseTo(atCap.lng, 9);
    expect(clamped.lat).toBeCloseTo(atCap.lat, 9);
  });

  it("treats negative elapsed time as zero (no movement)", () => {
    const track = makeTrack({ lat: 0, lng: 0, heading: 90, speedKnots: 600, onGround: false });
    const moved = extrapolateTrack(track, -5_000, 30_000);
    expect(moved.lng).toBeCloseTo(0, 9);
    expect(moved.lat).toBeCloseTo(0, 9);
  });
});

describe("extrapolateTracks", () => {
  it("uses each track's updatedAt to compute elapsed time", () => {
    const now = 60_000;
    const fresh = makeTrack({ id: "fresh", updatedAt: now }); // 0 ms elapsed
    const old = makeTrack({ id: "old", updatedAt: 0 }); // 60s elapsed
    const [movedFresh, movedOld] = extrapolateTracks([fresh, old], now, 60_000);

    expect(movedFresh.lng).toBeCloseTo(0, 6);
    expect(movedOld.lng).toBeGreaterThan(0);
  });

  it("respects the provided cap via MAX_EXTRAPOLATION_MS", () => {
    const track = makeTrack({ updatedAt: 0, lat: 0, lng: 0, heading: 90, speedKnots: 600 });
    const [moved] = extrapolateTracks([track], 10_000_000, MAX_EXTRAPOLATION_MS);
    const expectedMeters = 600 * KNOTS_TO_M_PER_S * (MAX_EXTRAPOLATION_MS / 1000);
    const actualMeters = haversineMeters(0, 0, moved.lat, moved.lng);
    expect(actualMeters).toBeCloseTo(expectedMeters, 0);
  });
});
