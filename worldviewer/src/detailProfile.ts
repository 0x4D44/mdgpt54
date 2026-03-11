export const MAX_BROWSER_ZOOM = 16.8;
export const STRESS_ZOOM = 16.15;
export const STRESS_PITCH = 55;

export const DENSE_SYMBOL_LAYER_IDS = [
  "poi_r20",
  "poi_r7",
  "poi_r1",
  "poi_transit",
  "road_one_way_arrow",
  "road_one_way_arrow_opposite",
  "label_other",
  "label_village",
  "label_town",
  "airport"
] as const;

export function shouldUsePerformanceMode(zoom: number, pitch: number): boolean {
  return zoom >= STRESS_ZOOM || (zoom >= STRESS_ZOOM - 0.35 && pitch >= STRESS_PITCH);
}
