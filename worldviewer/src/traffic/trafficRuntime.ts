import { MIN_LIVE_TRAFFIC_ZOOM, isStaticTrafficHost, type TrafficToggleState } from "./trafficHelpers";
import type { SnapshotStatus, TrafficConnectionStatus, TrafficLayerStatus } from "./trafficTypes";

export type AircraftRuntimeState = "off" | "zoom_blocked" | "loading" | "live" | "error";
export type ShipRuntimeState =
  | "off"
  | "zoom_blocked"
  | "connecting"
  | "live"
  | "error"
  | "unavailable";

export const STATIC_SHIP_MESSAGE =
  "Ships need a live relay and are unavailable on the static GitHub Pages build.";
export const AIRCRAFT_FEED_ERROR_MESSAGE =
  "Aircraft feed failed. Retrying live aircraft updates.";
export const SHIP_RELAY_ERROR_MESSAGE =
  "Ship relay disconnected. Reconnecting to live ship updates.";

export function resolveLocalTrafficStatus(
  state: TrafficToggleState,
  zoom: number,
  hostname: string
): SnapshotStatus {
  return {
    aircraft: resolveAircraftStatus(state.aircraftEnabled, zoom),
    ships: resolveShipStatus(state.shipsEnabled, zoom, hostname)
  };
}

export function summarizeConnectionStatus(
  aircraftState: AircraftRuntimeState,
  shipState: ShipRuntimeState
): TrafficConnectionStatus {
  const states = [aircraftState, shipState];
  if (states.includes("live")) {
    return "connected";
  }

  if (states.includes("loading") || states.includes("connecting")) {
    return "connecting";
  }

  if (aircraftState === "error") {
    return "aircraft_error";
  }

  if (states.includes("zoom_blocked")) {
    return "standby";
  }

  const activeStates = states.filter((state) => state !== "off");
  if (activeStates.length === 0) {
    return "disconnected";
  }

  if (activeStates.every((state) => state === "unavailable")) {
    return "unavailable";
  }

  return "disconnected";
}

function resolveAircraftStatus(enabled: boolean, zoom: number): TrafficLayerStatus {
  if (!enabled) {
    return { code: "ok", message: null };
  }

  if (zoom < MIN_LIVE_TRAFFIC_ZOOM) {
    return {
      code: "zoom_in",
      message: `Zoom in past ${MIN_LIVE_TRAFFIC_ZOOM.toFixed(0)} to activate live traffic.`
    };
  }

  return { code: "ok", message: null };
}

function resolveShipStatus(enabled: boolean, zoom: number, hostname: string): TrafficLayerStatus {
  if (!enabled) {
    return { code: "ok", message: null };
  }

  if (zoom < MIN_LIVE_TRAFFIC_ZOOM) {
    return {
      code: "zoom_in",
      message: `Zoom in past ${MIN_LIVE_TRAFFIC_ZOOM.toFixed(0)} to activate live traffic.`
    };
  }

  if (isStaticTrafficHost(hostname)) {
    return {
      code: "unavailable",
      message: STATIC_SHIP_MESSAGE
    };
  }

  return { code: "ok", message: null };
}
