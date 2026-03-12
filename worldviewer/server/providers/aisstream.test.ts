import { describe, expect, it } from "vitest";
import {
  bboxToAISStreamSubscription,
  parsePositionReport,
  parseShipStaticData,
} from "./aisstream";
import type { Bbox } from "../trafficModel";

describe("bboxToAISStreamSubscription", () => {
  it("maps canonical bbox to AISStream subscription message", () => {
    const bbox: Bbox = [-3.6, 55.8, -3.0, 56.1];
    const apiKey = "test-key";
    const sub = bboxToAISStreamSubscription(bbox, apiKey);

    expect(sub.APIKey).toBe("test-key");
    expect(sub.BoundingBoxes).toEqual([
      [
        [55.8, -3.6],  // [south, west] — AISStream uses [lat, lng]
        [56.1, -3.0],  // [north, east]
      ],
    ]);
    expect(sub.FiltersShipMMSI).toEqual([]);
    expect(sub.FilterMessageTypes).toEqual([
      "PositionReport",
      "ShipStaticData",
    ]);
  });
});

describe("parsePositionReport", () => {
  it("extracts a LiveTrack from an AISStream PositionReport message", () => {
    const msg = {
      MessageType: "PositionReport",
      MetaData: {
        MMSI: 211234567,
        ShipName: "BLUE HORIZON",
        time_utc: "2026-03-11T12:00:00Z",
      },
      Message: {
        PositionReport: {
          Longitude: -3.3,
          Latitude: 55.9,
          TrueHeading: 120,
          Sog: 12.5, // speed over ground in knots
          Cog: 118.3,
          NavigationalStatus: 0,
        },
      },
    };

    const now = Date.now();
    const track = parsePositionReport(msg, now);
    expect(track).not.toBeNull();
    expect(track!.id).toBe("211234567");
    expect(track!.kind).toBe("ship");
    expect(track!.lng).toBe(-3.3);
    expect(track!.lat).toBe(55.9);
    expect(track!.heading).toBe(120);
    expect(track!.speedKnots).toBe(12.5);
    expect(track!.altitudeMeters).toBeNull();
    expect(track!.label).toBe("BLUE HORIZON");
    expect(track!.source).toBe("aisstream");
    expect(track!.updatedAt).toBe(now);
  });

  it("returns null if position data is missing", () => {
    const msg = {
      MessageType: "PositionReport",
      MetaData: { MMSI: 211234567, ShipName: "", time_utc: "" },
      Message: {
        PositionReport: {
          Longitude: 181, // AISStream uses 181 for unavailable
          Latitude: 91,
          TrueHeading: 511,
          Sog: 102.3,
          Cog: 360,
          NavigationalStatus: 15,
        },
      },
    };
    expect(parsePositionReport(msg)).toBeNull();
  });

  it("treats TrueHeading 511 as null (unavailable per AIS spec)", () => {
    const msg = {
      MessageType: "PositionReport",
      MetaData: { MMSI: 211234567, ShipName: "TEST", time_utc: "" },
      Message: {
        PositionReport: {
          Longitude: -3.3,
          Latitude: 55.9,
          TrueHeading: 511,
          Sog: 5.0,
          Cog: 360,
          NavigationalStatus: 0,
        },
      },
    };
    const track = parsePositionReport(msg);
    expect(track!.heading).toBeNull();
  });

  it("returns null when MMSI is missing (prevents phantom 'undefined' id)", () => {
    const msg = {
      MessageType: "PositionReport",
      MetaData: { ShipName: "GHOST", time_utc: "" },
      Message: {
        PositionReport: {
          Longitude: -3.3,
          Latitude: 55.9,
          TrueHeading: 120,
          Sog: 5.0,
          Cog: 118.3,
          NavigationalStatus: 0,
        },
      },
    };
    expect(parsePositionReport(msg)).toBeNull();
  });

  it("falls back to course over ground when true heading is unavailable", () => {
    const msg = {
      MessageType: "PositionReport",
      MetaData: { MMSI: 211234567, ShipName: "TEST", time_utc: "" },
      Message: {
        PositionReport: {
          Longitude: -3.3,
          Latitude: 55.9,
          TrueHeading: 511,
          Sog: 5.0,
          Cog: 118.3,
          NavigationalStatus: 0,
        },
      },
    };
    const track = parsePositionReport(msg);
    expect(track!.heading).toBe(118.3);
  });
});

describe("parseShipStaticData", () => {
  it("extracts MMSI and ship name", () => {
    const msg = {
      MessageType: "ShipStaticData",
      MetaData: {
        MMSI: 211234567,
        ShipName: "BLUE HORIZON",
        time_utc: "2026-03-11T12:00:00Z",
      },
      Message: {
        ShipStaticData: {
          Name: "BLUE HORIZON",
          ImoNumber: 1234567,
          Type: 70,
        },
      },
    };
    const result = parseShipStaticData(msg);
    expect(result).toEqual({ mmsi: "211234567", name: "BLUE HORIZON" });
  });

  it("trims whitespace from ship name", () => {
    const msg = {
      MessageType: "ShipStaticData",
      MetaData: { MMSI: 211234567, ShipName: "  BLUE HORIZON  ", time_utc: "" },
      Message: {
        ShipStaticData: { Name: "  BLUE HORIZON  ", ImoNumber: 0, Type: 0 },
      },
    };
    const result = parseShipStaticData(msg);
    expect(result!.name).toBe("BLUE HORIZON");
  });
});
