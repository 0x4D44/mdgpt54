import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SOLAR_TERMINATOR_LAYER_ID,
  SOLAR_TERMINATOR_OPACITY,
  SOLAR_TERMINATOR_SOURCE_ID,
  buildNightFeature,
  createSolarTerminatorOverlay,
  getAntipode,
  getSubsolarPoint,
  normalizeLongitude
} from "./solarTerminator";

type LoadListener = () => void;

class MockMap {
  styleLoaded = true;
  readonly addSource = vi.fn((id: string, source: unknown) => {
    this.sources.set(id, {
      ...((source as Record<string, unknown>) ?? {}),
      setData: vi.fn()
    });
  });
  readonly getSource = vi.fn((id: string) => this.sources.get(id));
  readonly addLayer = vi.fn((layer: { id: string }, beforeId?: string) => {
    this.layers.set(layer.id, layer);
    this.layerAnchors.set(layer.id, beforeId);
  });
  readonly getLayer = vi.fn((id: string) => this.layers.get(id));
  readonly removeLayer = vi.fn((id: string) => {
    this.layers.delete(id);
    this.layerAnchors.delete(id);
  });
  readonly removeSource = vi.fn((id: string) => {
    this.sources.delete(id);
  });
  readonly isStyleLoaded = vi.fn(() => this.styleLoaded);
  readonly on = vi.fn((event: string, listener: LoadListener) => {
    if (event === "load") {
      this.loadListeners.add(listener);
    }
  });
  readonly off = vi.fn((event: string, listener: LoadListener) => {
    if (event === "load") {
      this.loadListeners.delete(listener);
    }
  });
  readonly getStyle = vi.fn(() => ({
    layers: [
      { id: "satellite-imagery", type: "raster", source: "satellite" },
      { id: "label_city", type: "symbol" }
    ]
  }));

  private readonly sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  private readonly layers = new Map<string, unknown>();
  private readonly layerAnchors = new Map<string, string | undefined>();
  private readonly loadListeners = new Set<LoadListener>();

  emitLoad(): void {
    this.styleLoaded = true;
    for (const listener of [...this.loadListeners]) {
      listener();
    }
  }

  getLayerAnchor(id: string): string | undefined {
    return this.layerAnchors.get(id);
  }
}

type LngLat = {
  lng: number;
  lat: number;
};

function getMaxLongitudeJump(ring: ReadonlyArray<GeoJSON.Position>): number {
  let maxJump = 0;

  for (let index = 1; index < ring.length; index += 1) {
    const [currentLongitude] = toLngLatTuple(ring[index]);
    const [previousLongitude] = toLngLatTuple(ring[index - 1]);
    const jump = Math.abs(currentLongitude - previousLongitude);
    if (jump > maxJump) {
      maxJump = jump;
    }
  }

  return maxJump;
}

function isPointInNightFeature(
  feature: GeoJSON.Feature<GeoJSON.MultiPolygon>,
  point: LngLat
): boolean {
  for (const polygon of feature.geometry.coordinates) {
    const outerRing = polygon[0];
    if (outerRing && isPointInRing(outerRing, point)) {
      return true;
    }
  }

  return false;
}

function isPointInRing(ring: ReadonlyArray<GeoJSON.Position>, point: LngLat): boolean {
  // Unwrap seam-crossing rings near the probe longitude before planar ray-casting.
  const unwrappedRing = unwrapRing(ring);
  const referenceLongitude =
    unwrappedRing.reduce((sum, [longitude]) => sum + longitude, 0) / unwrappedRing.length;
  const pointLongitude = wrapLongitudeNear(point.lng, referenceLongitude);
  let inside = false;

  for (
    let index = 0, previous = unwrappedRing.length - 1;
    index < unwrappedRing.length;
    previous = index, index += 1
  ) {
    const [x1, y1] = unwrappedRing[index];
    const [x2, y2] = unwrappedRing[previous];
    const intersects =
      (y1 > point.lat) !== (y2 > point.lat) &&
      pointLongitude < ((x2 - x1) * (point.lat - y1)) / (y2 - y1) + x1;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function unwrapRing(ring: ReadonlyArray<GeoJSON.Position>): Array<[number, number]> {
  const unwrapped: Array<[number, number]> = [];

  for (const position of ring) {
    const [longitude, latitude] = toLngLatTuple(position);
    const previous = unwrapped[unwrapped.length - 1];
    unwrapped.push(previous ? [wrapLongitudeNear(longitude, previous[0]), latitude] : [longitude, latitude]);
  }

  return unwrapped;
}

function wrapLongitudeNear(longitude: number, reference: number): number {
  let wrapped = longitude;

  while (wrapped - reference > 180) {
    wrapped -= 360;
  }
  while (wrapped - reference < -180) {
    wrapped += 360;
  }

  return wrapped;
}

function getSolarDotProduct(subsolarPoint: LngLat, point: LngLat): number {
  const subsolarLat = degreesToRadians(subsolarPoint.lat);
  const subsolarLng = degreesToRadians(subsolarPoint.lng);
  const latitude = degreesToRadians(point.lat);
  const longitude = degreesToRadians(point.lng);

  return (
    Math.sin(subsolarLat) * Math.sin(latitude) +
    Math.cos(subsolarLat) * Math.cos(latitude) * Math.cos(longitude - subsolarLng)
  );
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toLngLatTuple(position: GeoJSON.Position): [number, number] {
  return [position[0], position[1]];
}

function expectNightClassificationMatchesIllumination(
  date: Date,
  samples: ReadonlyArray<LngLat>,
  minimumAbsIllumination = 0.12
): void {
  const feature = buildNightFeature(date);
  const subsolarPoint = getSubsolarPoint(date);
  const antipode = getAntipode(subsolarPoint);

  expect(isPointInNightFeature(feature, subsolarPoint)).toBe(false);
  expect(isPointInNightFeature(feature, antipode)).toBe(true);

  for (const point of samples) {
    const illumination = getSolarDotProduct(subsolarPoint, point);
    if (Math.abs(illumination) < minimumAbsIllumination) {
      continue;
    }

    expect(isPointInNightFeature(feature, point)).toBe(illumination < 0);
  }
}

describe("solarTerminator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps longitude normalization inside the dateline bounds", () => {
    expect(normalizeLongitude(190)).toBe(-170);
    expect(normalizeLongitude(-190)).toBe(170);
    expect(normalizeLongitude(540)).toBe(180);
  });

  it("keeps solar declination near zero at the March equinox", () => {
    const subsolar = getSubsolarPoint(new Date("2026-03-20T12:00:00Z"));
    expect(subsolar.lat).toBeCloseTo(0, 0);
  });

  it("flips declination sign across the late-March equinox window", () => {
    expect(getSubsolarPoint(new Date("2026-03-21T12:00:00Z")).lat).toBeLessThan(0);
    expect(getSubsolarPoint(new Date("2026-03-22T00:00:00Z")).lat).toBeGreaterThan(0);
  });

  it("keeps solar declination near the June solstice maximum", () => {
    const subsolar = getSubsolarPoint(new Date("2026-06-21T12:00:00Z"));
    expect(subsolar.lat).toBeCloseTo(23.4, 0);
  });

  it("keeps solar declination near the December solstice minimum", () => {
    const subsolar = getSubsolarPoint(new Date("2026-12-21T12:00:00Z"));
    expect(subsolar.lat).toBeCloseTo(-23.4, 0);
  });

  it("builds antimeridian-safe multipolygon night geometry", () => {
    for (const isoDate of [
      "2026-03-20T00:00:00Z",
      "2026-03-20T12:00:00Z",
      "2026-06-21T12:00:00Z",
      "2026-12-21T12:00:00Z"
    ]) {
      const feature = buildNightFeature(new Date(isoDate));
      expect(feature.geometry.type).toBe("MultiPolygon");
      expect(feature.geometry.coordinates).toHaveLength(2);

      for (const polygon of feature.geometry.coordinates) {
        const ring = polygon[0];
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        expect(ring.length).toBeGreaterThan(20);
        expect(ring.every(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90)).toBe(true);
        expect(getMaxLongitudeJump(ring)).toBeLessThanOrEqual(180);
      }
    }
  });

  it("shades the night hemisphere and excludes sunlit points for both solstice signs", () => {
    const samples: LngLat[] = [
      { lng: -180, lat: -70 },
      { lng: -180, lat: 70 },
      { lng: -170, lat: -70 },
      { lng: -170, lat: 70 },
      { lng: -110, lat: -35 },
      { lng: -110, lat: 35 },
      { lng: -30, lat: -50 },
      { lng: -30, lat: 50 },
      { lng: 30, lat: -50 },
      { lng: 30, lat: 50 },
      { lng: 110, lat: -35 },
      { lng: 110, lat: 35 },
      { lng: 170, lat: -70 },
      { lng: 170, lat: 70 },
      { lng: 180, lat: -70 },
      { lng: 180, lat: 70 }
    ];

    for (const isoDate of ["2026-06-21T12:00:00Z", "2026-12-21T12:00:00Z"]) {
      expectNightClassificationMatchesIllumination(new Date(isoDate), samples);
    }
  });

  it("keeps antimeridian day-night classification correct across the March sign flip", () => {
    const seamSamples: LngLat[] = [
      { lng: -180, lat: -80 },
      { lng: -180, lat: 0 },
      { lng: -180, lat: 80 },
      { lng: -179.999, lat: -60 },
      { lng: -179.999, lat: 60 },
      { lng: 0, lat: -80 },
      { lng: 0, lat: 0 },
      { lng: 0, lat: 80 },
      { lng: 179.999, lat: -60 },
      { lng: 179.999, lat: 60 },
      { lng: 180, lat: -80 },
      { lng: 180, lat: 0 },
      { lng: 180, lat: 80 }
    ];

    for (const isoDate of ["2026-03-21T12:00:00Z", "2026-03-22T00:00:00Z"]) {
      expectNightClassificationMatchesIllumination(new Date(isoDate), seamSamples, 0.08);
    }
  });

  it("uses the HLD opacity fade stops", () => {
    expect(SOLAR_TERMINATOR_OPACITY).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.18,
      4.5,
      0.12,
      6,
      0
    ]);
  });

  it("waits for the first style load before adding the overlay", () => {
    const map = new MockMap();
    map.styleLoaded = false;
    const overlay = createSolarTerminatorOverlay({
      getNow: () => new Date("2026-03-20T12:00:00Z")
    });

    overlay.enable(map as never);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();

    map.emitLoad();
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map.getLayerAnchor(SOLAR_TERMINATOR_LAYER_ID)).toBe("label_city");
  });

  it("anchors above the last obscuring base layer when no label or road anchor is available", () => {
    const map = new MockMap();
    map.getStyle.mockReturnValue({
      layers: [
        { id: "background", type: "background" },
        { id: "admin-boundary", type: "line" },
        { id: "3d-buildings", type: "fill-extrusion" },
        { id: "settlement-dots", type: "circle" }
      ]
    });
    const overlay = createSolarTerminatorOverlay({
      getNow: () => new Date("2026-03-20T12:00:00Z")
    });

    overlay.enable(map as never);

    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map.getLayerAnchor(SOLAR_TERMINATOR_LAYER_ID)).toBe("settlement-dots");
  });

  it("does not duplicate the source or layer on repeated enable calls", () => {
    const map = new MockMap();
    const overlay = createSolarTerminatorOverlay({
      getNow: () => new Date("2026-03-20T12:00:00Z")
    });

    overlay.enable(map as never);
    overlay.enable(map as never);

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending load handler when disabled before style load", () => {
    const map = new MockMap();
    map.styleLoaded = false;
    const overlay = createSolarTerminatorOverlay({
      getNow: () => new Date("2026-03-20T12:00:00Z")
    });

    overlay.enable(map as never);
    overlay.disable(map as never);
    map.emitLoad();

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("updates the night geometry once per minute while enabled", () => {
    let now = new Date("2026-03-20T12:00:00Z");
    const map = new MockMap();
    const overlay = createSolarTerminatorOverlay({
      getNow: () => now
    });

    overlay.enable(map as never);
    const source = map.getSource(SOLAR_TERMINATOR_SOURCE_ID) as { setData: ReturnType<typeof vi.fn> };

    now = new Date("2026-03-20T12:01:00Z");
    vi.advanceTimersByTime(60_000);

    expect(source.setData).toHaveBeenCalledTimes(1);
  });

  it("removes the overlay cleanly and tolerates repeated disable calls", () => {
    const map = new MockMap();
    const overlay = createSolarTerminatorOverlay({
      getNow: () => new Date("2026-03-20T12:00:00Z")
    });

    overlay.enable(map as never);

    expect(() => {
      overlay.disable(map as never);
      overlay.disable(map as never);
    }).not.toThrow();
    expect(map.removeLayer).toHaveBeenCalledWith(SOLAR_TERMINATOR_LAYER_ID);
    expect(map.removeSource).toHaveBeenCalledWith(SOLAR_TERMINATOR_SOURCE_ID);
  });
});
