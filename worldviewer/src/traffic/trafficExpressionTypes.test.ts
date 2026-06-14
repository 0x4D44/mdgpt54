import type { ExpressionSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { altitudeColorExpression } from "./trafficHelpers";

// Compile-time regression: altitudeColorExpression must be a well-typed MapLibre
// expression so the layer paint property needs no `as any`. Before the fix its
// return type was `unknown[]` and this assignment failed tsc with TS2322.
const _typedExpression: ExpressionSpecification = altitudeColorExpression();

describe("altitudeColorExpression typing", () => {
  it("is a typed interpolate expression", () => {
    expect(_typedExpression[0]).toBe("interpolate");
  });
});
