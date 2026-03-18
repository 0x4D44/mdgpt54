import type { Bbox } from "../src/traffic/trafficTypes";

/** Compute the union of multiple bboxes, or null if the list is empty. */
export function bboxUnion(boxes: Bbox[]): Bbox | null {
  if (boxes.length === 0) return null;
  let [west, south, east, north] = boxes[0];
  for (let i = 1; i < boxes.length; i++) {
    const b = boxes[i];
    if (b[0] < west) west = b[0];
    if (b[1] < south) south = b[1];
    if (b[2] > east) east = b[2];
    if (b[3] > north) north = b[3];
  }
  return [west, south, east, north];
}

/** Area of a bbox in degree². Useful for a simple "too large" guard. */
export function bboxArea(b: Bbox): number {
  return (b[2] - b[0]) * (b[3] - b[1]);
}

/** Check whether a point (lng, lat) falls within a bbox (inclusive). */
export function pointInBbox(lng: number, lat: number, b: Bbox): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}
