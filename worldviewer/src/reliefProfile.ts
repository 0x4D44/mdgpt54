export const TERRAIN_MESH_SOURCE_ID = "terrain-mesh";
export const RELIEF_DEM_SOURCE_ID = "terrain-relief-dem";
export const CONTOUR_SOURCE_ID = "terrain-contours";

export const RELIEF_LAYER_IDS = [
  "terrain-hillshade",
  "terrain-contours-line",
  "terrain-contours-label"
] as const;

export const HILLSHADE_EXAGGERATION_STOPS = [
  [6, 0.55],
  [10, 0.82],
  [13, 0.92],
  [16, 0.58]
] as const;

export const RELIEF_SATELLITE_OPACITY_STOPS = [
  [0, 1],
  [17, 1]
] as const;

export const DEFAULT_SATELLITE_OPACITY_STOPS = [
  [0, 1],
  [8, 1],
  [12, 0.93],
  [16, 0.88],
  [17, 0.84]
] as const;

export const CONTOUR_THRESHOLDS: Record<number, number[]> = {
  10: [50, 200],
  11: [25, 100],
  12: [20, 100],
  13: [10, 50],
  14: [10, 50],
  15: [5, 25]
};

export function normalizeTerrainElevation(exaggeratedHeight: number, exaggeration: number): number {
  return exaggeratedHeight / exaggeration;
}

export function getHillshadeExaggerationExpression(): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...HILLSHADE_EXAGGERATION_STOPS.flatMap(([zoom, value]) => [zoom, value])
  ];
}

export function getSatelliteOpacity(zoom: number, pitch: number, reliefEnabled: boolean): number {
  const baseOpacity = interpolateStops(
    reliefEnabled ? RELIEF_SATELLITE_OPACITY_STOPS : DEFAULT_SATELLITE_OPACITY_STOPS,
    zoom
  );

  if (reliefEnabled) {
    return baseOpacity;
  }

  let penalty = pitch >= 70 ? 0.24 : pitch >= 55 ? 0.18 : 0.08;
  if (zoom >= 8.5 && zoom <= 13.5) {
    penalty += 0.12;
  }

  return clamp(baseOpacity - penalty, 0.34, 1);
}

function interpolateStops(stops: ReadonlyArray<readonly [number, number]>, input: number): number {
  const [firstZoom, firstValue] = stops[0];
  if (input <= firstZoom) {
    return firstValue;
  }

  for (let index = 1; index < stops.length; index += 1) {
    const [currentZoom, currentValue] = stops[index];
    if (input <= currentZoom) {
      const [previousZoom, previousValue] = stops[index - 1];
      const ratio = (input - previousZoom) / (currentZoom - previousZoom);
      return previousValue + (currentValue - previousValue) * ratio;
    }
  }

  return stops[stops.length - 1][1];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getTerrainExaggeration(zoom: number): number {
  if (zoom < 6) {
    return 1.1;
  }

  if (zoom < 8.5) {
    return 1.45;
  }

  if (zoom < 11.5) {
    return 2.35;
  }

  if (zoom < 13.5) {
    return 2.05;
  }

  if (zoom < 15.5) {
    return 1.65;
  }

  return 1.25;
}
