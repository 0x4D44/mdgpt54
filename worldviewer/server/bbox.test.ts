import { describe, expect, it } from "vitest";
import { bboxUnion, bboxArea, pointInBbox } from "./bbox";
import type { Bbox } from "./trafficModel";

describe("bboxUnion", () => {
  it("returns null for an empty list", () => {
    expect(bboxUnion([])).toBeNull();
  });

  it("returns the single bbox unchanged", () => {
    const b: Bbox = [-3.6, 55.8, -3.0, 56.1];
    expect(bboxUnion([b])).toEqual(b);
  });

  it("computes the union of two overlapping bboxes", () => {
    const a: Bbox = [-4, 55, -2, 57];
    const b: Bbox = [-3, 54, -1, 56];
    expect(bboxUnion([a, b])).toEqual([-4, 54, -1, 57]);
  });

  it("computes the union of disjoint bboxes", () => {
    const a: Bbox = [0, 0, 1, 1];
    const b: Bbox = [10, 10, 11, 11];
    expect(bboxUnion([a, b])).toEqual([0, 0, 11, 11]);
  });
});

describe("bboxArea", () => {
  it("returns the area in degree² for a simple bbox", () => {
    const b: Bbox = [0, 0, 10, 10];
    expect(bboxArea(b)).toBeCloseTo(100);
  });

  it("handles negative coordinates", () => {
    const b: Bbox = [-5, -5, 5, 5];
    expect(bboxArea(b)).toBeCloseTo(100);
  });
});

describe("pointInBbox", () => {
  const b: Bbox = [-3.6, 55.8, -3.0, 56.1];

  it("returns true for a point inside", () => {
    expect(pointInBbox(-3.3, 55.9, b)).toBe(true);
  });

  it("returns true for a point on the boundary", () => {
    expect(pointInBbox(-3.6, 55.8, b)).toBe(true);
  });

  it("returns false for a point outside", () => {
    expect(pointInBbox(-2.5, 55.9, b)).toBe(false);
    expect(pointInBbox(-3.3, 57.0, b)).toBe(false);
  });
});
