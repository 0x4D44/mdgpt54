import { describe, expect, it } from "vitest";

import { resolveLocalTrafficStatus, STATIC_SHIP_MESSAGE, summarizeConnectionStatus } from "./trafficRuntime";

describe("resolveLocalTrafficStatus", () => {
  it("keeps both layers ok when disabled", () => {
    expect(
      resolveLocalTrafficStatus(
        { aircraftEnabled: false, shipsEnabled: false },
        8,
        "localhost"
      )
    ).toEqual({
      aircraft: { code: "ok", message: null },
      ships: { code: "ok", message: null }
    });
  });

  it("returns zoom_in for enabled layers below the minimum zoom", () => {
    expect(
      resolveLocalTrafficStatus(
        { aircraftEnabled: true, shipsEnabled: true },
        4.5,
        "localhost"
      )
    ).toEqual({
      aircraft: { code: "zoom_in", message: "Zoom in past 5 to activate live traffic." },
      ships: { code: "zoom_in", message: "Zoom in past 5 to activate live traffic." }
    });
  });

  it("keeps aircraft available on GitHub Pages while marking ships unavailable", () => {
    expect(
      resolveLocalTrafficStatus(
        { aircraftEnabled: true, shipsEnabled: true },
        8,
        "0x4d44.github.io"
      )
    ).toEqual({
      aircraft: { code: "ok", message: null },
      ships: { code: "unavailable", message: STATIC_SHIP_MESSAGE }
    });
  });
});

describe("summarizeConnectionStatus", () => {
  it("reports live when either transport is live", () => {
    expect(summarizeConnectionStatus("live", "off")).toBe("connected");
    expect(summarizeConnectionStatus("off", "live")).toBe("connected");
  });

  it("reports connecting while waiting on active transports", () => {
    expect(summarizeConnectionStatus("loading", "off")).toBe("connecting");
    expect(summarizeConnectionStatus("off", "connecting")).toBe("connecting");
  });

  it("reports standby when traffic is enabled but zoom-blocked", () => {
    expect(summarizeConnectionStatus("zoom_blocked", "off")).toBe("standby");
  });

  it("reports unavailable when static-host ships are the only enabled source", () => {
    expect(summarizeConnectionStatus("off", "unavailable")).toBe("unavailable");
  });

  it("reports disconnected when enabled transports fail", () => {
    expect(summarizeConnectionStatus("error", "off")).toBe("disconnected");
    expect(summarizeConnectionStatus("off", "error")).toBe("disconnected");
  });
});
