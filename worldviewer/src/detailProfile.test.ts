import { describe, expect, it } from "vitest";

import { MAX_BROWSER_ZOOM, STRESS_PITCH, STRESS_ZOOM, shouldUsePerformanceMode } from "./detailProfile";

describe("shouldUsePerformanceMode", () => {
  it("stays off at ordinary street zoom", () => {
    expect(shouldUsePerformanceMode(15.6, 40)).toBe(false);
    expect(shouldUsePerformanceMode(STRESS_ZOOM - 0.5, STRESS_PITCH - 5)).toBe(false);
  });

  it("activates once zoom reaches the dense detail threshold", () => {
    expect(shouldUsePerformanceMode(STRESS_ZOOM, 10)).toBe(true);
    expect(shouldUsePerformanceMode(MAX_BROWSER_ZOOM, 45)).toBe(true);
  });

  it("activates slightly earlier when the camera is heavily pitched", () => {
    expect(shouldUsePerformanceMode(STRESS_ZOOM - 0.2, STRESS_PITCH)).toBe(true);
    expect(shouldUsePerformanceMode(STRESS_ZOOM - 0.34, STRESS_PITCH + 10)).toBe(true);
  });
});
