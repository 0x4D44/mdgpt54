import { describe, expect, it } from "vitest";

import { buildLayerStatusHints } from "./trafficUI";
import type { SnapshotStatus } from "./trafficTypes";

function makeStatus(
  aircraftCode: SnapshotStatus["aircraft"]["code"] = "ok",
  shipsCode: SnapshotStatus["ships"]["code"] = "ok",
  aircraftMsg: string | null = null,
  shipsMsg: string | null = null
): SnapshotStatus {
  return {
    aircraft: { code: aircraftCode, message: aircraftMsg },
    ships: { code: shipsCode, message: shipsMsg }
  };
}

describe("buildLayerStatusHints", () => {
  it("returns empty when both layers are ok", () => {
    expect(buildLayerStatusHints(makeStatus(), true, true)).toEqual([]);
  });

  it("returns empty when no layers are enabled", () => {
    expect(buildLayerStatusHints(makeStatus("zoom_in", "unavailable"), false, false)).toEqual([]);
  });

  it("returns zoom_in hint for aircraft when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("zoom_in"), true, false);
    expect(hints).toEqual(["Zoom in for aircraft"]);
  });

  it("returns zoom_in hint for ships when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("ok", "zoom_in"), false, true);
    expect(hints).toEqual(["Zoom in for ships"]);
  });

  it("returns unavailable hint for aircraft when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("unavailable"), true, false);
    expect(hints).toEqual(["Aircraft unavailable"]);
  });

  it("returns unavailable hint for ships when enabled", () => {
    const hints = buildLayerStatusHints(makeStatus("ok", "unavailable"), false, true);
    expect(hints).toEqual(["Ships unavailable"]);
  });

  it("uses server message when provided", () => {
    const status = makeStatus("zoom_in", "unavailable", "Zoom to z8+ for aircraft", "AIS offline");
    const hints = buildLayerStatusHints(status, true, true);
    expect(hints).toEqual(["Zoom to z8+ for aircraft", "AIS offline"]);
  });

  it("returns hints for both layers when both are degraded", () => {
    const hints = buildLayerStatusHints(makeStatus("zoom_in", "zoom_in"), true, true);
    expect(hints).toEqual(["Zoom in for aircraft", "Zoom in for ships"]);
  });

  it("ignores disabled layers even when degraded", () => {
    const hints = buildLayerStatusHints(makeStatus("zoom_in", "unavailable"), true, false);
    expect(hints).toEqual(["Zoom in for aircraft"]);
  });

  it("prefers a local zoom hint over server zoom_in hints", () => {
    const hints = buildLayerStatusHints(
      makeStatus("zoom_in", "zoom_in"),
      true,
      true,
      "Zoom in past 5 to activate live traffic."
    );
    expect(hints).toEqual(["Zoom in past 5 to activate live traffic."]);
  });

  it("keeps unavailable hints alongside a local zoom hint", () => {
    const hints = buildLayerStatusHints(
      makeStatus("zoom_in", "unavailable"),
      true,
      true,
      "Zoom in past 5 to activate live traffic."
    );
    expect(hints).toEqual(["Zoom in past 5 to activate live traffic.", "Ships unavailable"]);
  });
});
