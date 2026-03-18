import type { Bbox, LiveTrack } from "../../src/traffic/trafficTypes";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export type AISStreamSubscription = {
  APIKey: string;
  BoundingBoxes: [latLng: [number, number], latLng: [number, number]][];
  FiltersShipMMSI: string[];
  FilterMessageTypes: string[];
};

function normalizeHeading(trueHeading: unknown, courseOverGround: unknown): number | null {
  if (typeof trueHeading === "number" && trueHeading >= 0 && trueHeading <= 359) {
    return trueHeading;
  }
  if (typeof courseOverGround === "number" && courseOverGround >= 0 && courseOverGround < 360) {
    return courseOverGround;
  }
  return null;
}

/**
 * Convert canonical [west, south, east, north] to AISStream subscription.
 * AISStream uses [[south, west], [north, east]] corner pairs.
 */
export function bboxToAISStreamSubscription(
  bbox: Bbox,
  apiKey: string,
): AISStreamSubscription {
  return {
    APIKey: apiKey,
    BoundingBoxes: [
      [
        [bbox[1], bbox[0]], // [south, west]
        [bbox[3], bbox[2]], // [north, east]
      ],
    ],
    FiltersShipMMSI: [],
    FilterMessageTypes: ["PositionReport", "ShipStaticData"],
  };
}

/**
 * Parse an AISStream PositionReport message into a LiveTrack.
 * Returns null if the position is invalid (AIS uses 181/91 for unavailable).
 */
export function parsePositionReport(msg: unknown, now: number = Date.now()): LiveTrack | null {
  const root = asRecord(msg);
  if (!root) return null;

  const message = asRecord(root.Message);
  const pos = asRecord(message?.PositionReport);
  if (!pos) return null;

  const lng = pos.Longitude;
  const lat = pos.Latitude;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (lng > 180 || lng < -180 || lat > 90 || lat < -90) return null;

  const meta = asRecord(root.MetaData);
  const mmsi = meta?.MMSI;
  if (mmsi == null) return null;

  const shipName = meta?.ShipName;

  return {
    id: String(mmsi),
    kind: "ship",
    lng,
    lat,
    heading: normalizeHeading(pos.TrueHeading, pos.Cog),
    speedKnots: typeof pos.Sog === "number" ? pos.Sog : null,
    altitudeMeters: null,
    label: typeof shipName === "string" ? shipName.trim() || null : null,
    source: "aisstream",
    updatedAt: now,
  };
}

/**
 * Parse an AISStream ShipStaticData message into a name lookup entry.
 * Returns null if the message is malformed.
 */
export function parseShipStaticData(msg: unknown): { mmsi: string; name: string } | null {
  const root = asRecord(msg);
  if (!root) return null;

  const meta = asRecord(root.MetaData);
  const mmsi = meta?.MMSI;

  const message = asRecord(root.Message);
  const staticData = asRecord(message?.ShipStaticData);
  const name = staticData?.Name ?? meta?.ShipName;

  if (mmsi == null || !name) return null;
  return { mmsi: String(mmsi), name: String(name).trim() };
}
