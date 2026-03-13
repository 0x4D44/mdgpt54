import { describe, expect, it } from "vitest";

import { resolveProjectionMode, shouldShowNightOverlay } from "./projectionBehavior";

describe("projectionBehavior", () => {
  it("keeps mercator active through the 5..6 hysteresis band and hides Night there", () => {
    const projectionMode = resolveProjectionMode(5.5, "mercator");

    expect(projectionMode).toBe("mercator");
    expect(shouldShowNightOverlay(true, projectionMode)).toBe(false);
  });

  it("keeps globe active through the 5..6 hysteresis band until the switch threshold", () => {
    const projectionMode = resolveProjectionMode(5.5, "globe");

    expect(projectionMode).toBe("globe");
    expect(shouldShowNightOverlay(true, projectionMode)).toBe(true);
  });

  it("preserves the existing projection thresholds at 5 and 6", () => {
    expect(resolveProjectionMode(6, "globe")).toBe("mercator");
    expect(resolveProjectionMode(5, "mercator")).toBe("globe");
  });
});
