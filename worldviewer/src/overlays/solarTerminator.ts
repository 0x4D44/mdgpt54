import type { FillLayerSpecification, Map } from "maplibre-gl";

import {
  findFirstLabelLayerId,
  findFirstNonBaseContentLayerId,
  findFirstRoadLayerId,
  type OverlayAnchorLayer
} from "./overlayAnchors";

export const SOLAR_TERMINATOR_SOURCE_ID = "solar-terminator";
export const SOLAR_TERMINATOR_LAYER_ID = "solar-terminator";
export const SOLAR_TERMINATOR_OPACITY = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  0.18,
  4.5,
  0.12,
  6,
  0
] as const;

const SOLAR_UPDATE_INTERVAL_MS = 60_000;
const NIGHT_FILL_COLOR = "#030812";
const DEFAULT_TERMINATOR_STEP_DEGREES = 2;
const PRIME_MERIDIAN_SPLIT_LONGITUDE = 0;

type LngLat = {
  lng: number;
  lat: number;
};

type GeoJSONSourceLike = {
  setData(data: GeoJSON.Feature<GeoJSON.MultiPolygon>): void;
};

type SolarTerminatorOptions = {
  getNow?: () => Date;
  updateIntervalMs?: number;
};

export function normalizeLongitude(longitude: number): number {
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}

export function getSubsolarPoint(date: Date): LngLat {
  const dayOfYear = getDayOfYearUtc(date);
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3_600_000;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const declinationRadians =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const equationOfTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  return {
    lng: normalizeLongitude(15 * (12 - utcHours - equationOfTimeMinutes / 60)),
    lat: radiansToDegrees(declinationRadians)
  };
}

export function getAntipode(point: LngLat): LngLat {
  return {
    lng: normalizeLongitude(point.lng + 180),
    lat: -point.lat
  };
}

export function buildNightFeature(date: Date): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  const subsolarPoint = getSubsolarPoint(date);

  return {
    type: "Feature",
    properties: {
      generatedAt: date.toISOString()
    },
    geometry: buildNightGeometry(subsolarPoint)
  };
}

export function createSolarTerminatorOverlay(options: SolarTerminatorOptions = {}) {
  let getNow = options.getNow ?? (() => new Date());
  const updateIntervalMs = options.updateIntervalMs ?? SOLAR_UPDATE_INTERVAL_MS;
  let currentMap: Map | null = null;
  let loadHandler: (() => void) | null = null;
  let loadHandlerMap: Map | null = null;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let revision = 0;

  const clearLoadHandler = () => {
    if (loadHandler && loadHandlerMap) {
      loadHandlerMap.off("load", loadHandler);
    }

    loadHandler = null;
    loadHandlerMap = null;
  };

  const clearTimer = () => {
    if (timer !== null) {
      globalThis.clearInterval(timer);
      timer = null;
    }
  };

  const syncOverlay = (map: Map) => {
    const nextFeature = buildNightFeature(getNow());
    const existingSource = map.getSource(SOLAR_TERMINATOR_SOURCE_ID);

    if (existingSource && hasSetData(existingSource)) {
      existingSource.setData(nextFeature);
    } else if (!existingSource) {
      map.addSource(SOLAR_TERMINATOR_SOURCE_ID, {
        type: "geojson",
        data: nextFeature
      });
    }

    if (!map.getLayer(SOLAR_TERMINATOR_LAYER_ID)) {
      const layers = (map.getStyle().layers ?? []) as OverlayAnchorLayer[];
      const beforeId =
        findFirstLabelLayerId(layers) ??
        findFirstRoadLayerId(layers) ??
        findFirstNonBaseContentLayerId(layers);
      map.addLayer(createSolarTerminatorLayer(), beforeId);
    }
  };

  const startTimer = (map: Map, token: number) => {
    clearTimer();
    timer = globalThis.setInterval(() => {
      if (revision !== token || currentMap !== map) {
        return;
      }

      syncOverlay(map);
    }, updateIntervalMs);
  };

  const enable = (map: Map) => {
    currentMap = map;
    revision += 1;
    const token = revision;
    clearLoadHandler();
    clearTimer();

    const apply = () => {
      if (revision !== token || currentMap !== map) {
        return;
      }

      clearLoadHandler();
      syncOverlay(map);
      startTimer(map, token);
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    loadHandler = () => {
      apply();
    };
    loadHandlerMap = map;
    map.on("load", loadHandler);
  };

  const disable = (map: Map) => {
    revision += 1;
    clearTimer();
    clearLoadHandler();

    if (map.getLayer(SOLAR_TERMINATOR_LAYER_ID)) {
      map.removeLayer(SOLAR_TERMINATOR_LAYER_ID);
    }
    if (map.getSource(SOLAR_TERMINATOR_SOURCE_ID)) {
      map.removeSource(SOLAR_TERMINATOR_SOURCE_ID);
    }

    if (currentMap === map) {
      currentMap = null;
    }
  };

  const setGetNow = (fn: () => Date) => {
    getNow = fn;
    if (currentMap) {
      syncOverlay(currentMap);
    }
  };

  return {
    enable,
    disable,
    setGetNow
  };
}

function createSolarTerminatorLayer(): FillLayerSpecification {
  return {
    id: SOLAR_TERMINATOR_LAYER_ID,
    type: "fill",
    source: SOLAR_TERMINATOR_SOURCE_ID,
    paint: {
      "fill-color": NIGHT_FILL_COLOR,
      "fill-opacity":
        SOLAR_TERMINATOR_OPACITY as unknown as NonNullable<FillLayerSpecification["paint"]>["fill-opacity"]
    }
  };
}

function hasSetData(source: unknown): source is GeoJSONSourceLike {
  return typeof source === "object" && source !== null && "setData" in source;
}

function buildNightGeometry(
  subsolarPoint: LngLat,
  stepDegrees = DEFAULT_TERMINATOR_STEP_DEGREES
): GeoJSON.MultiPolygon {
  const step = clampStepDegrees(stepDegrees);
  const nightPoleLatitude = subsolarPoint.lat < 0 ? 90 : -90;
  const westBoundary = buildTerminatorBoundary(
    subsolarPoint,
    -180,
    PRIME_MERIDIAN_SPLIT_LONGITUDE,
    step
  );
  const eastBoundary = buildTerminatorBoundary(
    subsolarPoint,
    PRIME_MERIDIAN_SPLIT_LONGITUDE,
    180,
    step
  );
  const westRing = closeRing([
    [-180, nightPoleLatitude],
    ...westBoundary,
    [PRIME_MERIDIAN_SPLIT_LONGITUDE, nightPoleLatitude]
  ]);
  const eastRing = closeRing([
    [PRIME_MERIDIAN_SPLIT_LONGITUDE, nightPoleLatitude],
    ...eastBoundary,
    [180, nightPoleLatitude]
  ]);

  return {
    type: "MultiPolygon",
    coordinates: [[westRing], [eastRing]]
  };
}

function buildTerminatorBoundary(
  subsolarPoint: LngLat,
  startLongitude: number,
  endLongitude: number,
  stepDegrees: number
): Array<[number, number]> {
  const boundary: Array<[number, number]> = [];
  const direction = endLongitude >= startLongitude ? 1 : -1;
  const step = stepDegrees * direction;
  let longitude = startLongitude;

  boundary.push([normalizeLongitude(startLongitude), getTerminatorLatitude(subsolarPoint, startLongitude)]);

  while (
    (direction > 0 && longitude + step < endLongitude) ||
    (direction < 0 && longitude + step > endLongitude)
  ) {
    longitude += step;
    boundary.push([normalizeLongitude(longitude), getTerminatorLatitude(subsolarPoint, longitude)]);
  }

  boundary.push([normalizeLongitude(endLongitude), getTerminatorLatitude(subsolarPoint, endLongitude)]);

  return dedupeConsecutivePoints(boundary);
}

function getTerminatorLatitude(subsolarPoint: LngLat, longitude: number): number {
  const declination = degreesToRadians(subsolarPoint.lat);
  const longitudeOffset = degreesToRadians(normalizeLongitude(longitude - subsolarPoint.lng));
  const numerator = -Math.cos(declination) * Math.cos(longitudeOffset);
  const denominator = Math.sin(declination);
  const latitude = radiansToDegrees(toPrincipalLatitudeRadians(Math.atan2(numerator, denominator)));
  return clampLatitude(latitude);
}

function toPrincipalLatitudeRadians(angle: number): number {
  if (angle > Math.PI / 2) {
    return angle - Math.PI;
  }
  if (angle < -Math.PI / 2) {
    return angle + Math.PI;
  }
  return angle;
}

function clampStepDegrees(stepDegrees: number): number {
  if (!Number.isFinite(stepDegrees)) {
    return DEFAULT_TERMINATOR_STEP_DEGREES;
  }

  return Math.max(1, Math.abs(stepDegrees));
}

function clampLatitude(latitude: number): number {
  if (latitude > 90) {
    return 90;
  }
  if (latitude < -90) {
    return -90;
  }
  return latitude;
}

function closeRing(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length === 0) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (sameCoordinate(first, last)) {
    return points;
  }

  return [...points, first];
}

function dedupeConsecutivePoints(points: Array<[number, number]>): Array<[number, number]> {
  const deduped: Array<[number, number]> = [];

  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !sameCoordinate(previous, point)) {
      deduped.push(point);
    }
  }

  return deduped;
}

function sameCoordinate(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function getDayOfYearUtc(date: Date): number {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const currentDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((currentDay - startOfYear) / 86_400_000);
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
