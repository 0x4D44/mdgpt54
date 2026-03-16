import { describe, expect, it } from "vitest";

import {
  AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX,
  AIRCRAFT_ICON_MAX_SCALE,
  AIRCRAFT_ICON_PIXEL_RATIO,
  AIRCRAFT_ICON_SIZE,
  aircraftIconSizeExpression
} from "./aircraftIconSizing";

/**
 * Evaluates a Mapbox GL `["interpolate", ["linear"], ["zoom"], ...stops]`
 * expression for a given zoom level. Clamps outside the stop range.
 */
function evaluateLinearInterpolation(
  expression: readonly [string, string[], string[], ...number[]],
  zoom: number
): number {
  // Skip the first 3 elements: "interpolate", ["linear"], ["zoom"]
  const stops = expression.slice(3) as number[];
  const zooms: number[] = [];
  const values: number[] = [];

  for (let i = 0; i < stops.length; i += 2) {
    zooms.push(stops[i]);
    values.push(stops[i + 1]);
  }

  // Clamp below first stop
  if (zoom <= zooms[0]) {
    return values[0];
  }

  // Clamp above last stop
  if (zoom >= zooms[zooms.length - 1]) {
    return values[values.length - 1];
  }

  // Find the surrounding stops and interpolate
  for (let i = 0; i < zooms.length - 1; i++) {
    if (zoom >= zooms[i] && zoom <= zooms[i + 1]) {
      const t = (zoom - zooms[i]) / (zooms[i + 1] - zooms[i]);
      return values[i] + t * (values[i + 1] - values[i]);
    }
  }

  return values[values.length - 1];
}

describe("aircraftIconSizing", () => {
  it("derives the max 2D symbol pixel size from base constants", () => {
    const expected = (AIRCRAFT_ICON_SIZE / AIRCRAFT_ICON_PIXEL_RATIO) * AIRCRAFT_ICON_MAX_SCALE;

    expect(AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX).toBe(expected);
  });

  it("returns the expected zoom interpolation expression", () => {
    expect(aircraftIconSizeExpression()).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      0.42,
      8,
      0.48,
      12,
      0.58
    ]);
  });

  it("ramps scale linearly between declared zoom stops", () => {
    const expression = aircraftIconSizeExpression();

    // Below min stop — clamped
    expect(evaluateLinearInterpolation(expression, 3)).toBe(0.42);

    // At min stop
    expect(evaluateLinearInterpolation(expression, 5)).toBe(0.42);

    // Mid-range (low): lerp(0.42, 0.48, (6.5-5)/(8-5)) = 0.45
    expect(evaluateLinearInterpolation(expression, 6.5)).toBeCloseTo(0.45, 10);

    // At mid stop
    expect(evaluateLinearInterpolation(expression, 8)).toBe(0.48);

    // Mid-range (high): lerp(0.48, 0.58, (10-8)/(12-8)) = 0.53
    expect(evaluateLinearInterpolation(expression, 10)).toBeCloseTo(0.53, 10);

    // At max stop
    expect(evaluateLinearInterpolation(expression, 12)).toBe(0.58);

    // Above max stop — clamped
    expect(evaluateLinearInterpolation(expression, 15)).toBe(0.58);
  });

  it("increases monotonically across all zoom levels", () => {
    const expression = aircraftIconSizeExpression();
    let previous = evaluateLinearInterpolation(expression, 0);

    for (let zoom = 0.5; zoom <= 20; zoom += 0.5) {
      const current = evaluateLinearInterpolation(expression, zoom);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});
