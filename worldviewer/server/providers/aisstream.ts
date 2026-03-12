import type { Bbox, LiveTrack } from "../trafficModel";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePositionReport(msg: any, now: number = Date.now()): LiveTrack | null {
  const pos = msg?.Message?.PositionReport;
  if (!pos) return null;

  const lng: number = pos.Longitude;
  const lat: number = pos.Latitude;
  if (lng > 180 || lng < -180 || lat > 90 || lat < -90) return null;

  const mmsi = msg.MetaData?.MMSI;
  if (mmsi == null) return null;

  const shipName: string | undefined = msg.MetaData?.ShipName;

  return {
    id: String(mmsi),
    kind: "ship",
    lng,
    lat,
    heading: normalizeHeading(pos.TrueHeading, pos.Cog),
    speedKnots: typeof pos.Sog === "number" ? pos.Sog : null,
    altitudeMeters: null,
    label: shipName?.trim() || null,
    source: "aisstream",
    updatedAt: now,
  };
}

/**
 * Parse an AISStream ShipStaticData message into a name lookup entry.
 * Returns null if the message is malformed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseShipStaticData(msg: any): { mmsi: string; name: string } | null {
  const mmsi = msg?.MetaData?.MMSI;
  const name = msg?.Message?.ShipStaticData?.Name ?? msg?.MetaData?.ShipName;
  if (mmsi == null || !name) return null;
  return { mmsi: String(mmsi), name: String(name).trim() };
}
