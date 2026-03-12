import { describe, expect, it } from "vitest";

import {
  buildAircraftDatabaseHeaderIndex,
  deriveRenderModelKey,
  extractAircraftIdentityEntry,
  formatAircraftModelDescription,
  parseAircraftDatabaseCsvLine,
  parseAircraftIdentityShard
} from "./aircraftIdentityData";

describe("parseAircraftDatabaseCsvLine", () => {
  it("parses quoted and unquoted CSV fields from the OpenSky snapshot format", () => {
    expect(parseAircraftDatabaseCsvLine("'abc123',B738,'Boeing, Inc.','737-800'")).toEqual([
      "abc123",
      "B738",
      "Boeing, Inc.",
      "737-800"
    ]);
  });

  it("preserves doubled quote escapes inside quoted fields", () => {
    expect(parseAircraftDatabaseCsvLine("'abc123','owner''s special'")).toEqual([
      "abc123",
      "owner's special"
    ]);
  });
});

describe("extractAircraftIdentityEntry", () => {
  it("pulls the Step 2 fields from a parsed OpenSky aircraft database row", () => {
    const headerIndex = buildAircraftDatabaseHeaderIndex([
      "icao24",
      "registration",
      "typeCode",
      "manufacturerName",
      "model",
      "ignored"
    ]);

    expect(
      extractAircraftIdentityEntry(["abc123", "N123AB", "b738", "Boeing", "737-800", "x"], headerIndex)
    ).toEqual({
      icao24: "abc123",
      prefix: "ab",
      identity: ["N123AB", "B738", "Boeing", "737-800"]
    });
  });

  it("keeps available fields when optional headers are missing from a snapshot", () => {
    const headerIndex = buildAircraftDatabaseHeaderIndex(["icao24", "registration", "model"]);

    expect(extractAircraftIdentityEntry(["abc123", "N123AB", "737-800"], headerIndex)).toEqual({
      icao24: "abc123",
      prefix: "ab",
      identity: ["N123AB", null, null, "737-800"]
    });
  });

  it("drops rows that do not carry any useful Step 2 identity fields", () => {
    const headerIndex = buildAircraftDatabaseHeaderIndex([
      "icao24",
      "registration",
      "typecode",
      "manufacturerName",
      "model"
    ]);

    expect(extractAircraftIdentityEntry(["abc123", "", "", "", ""], headerIndex)).toBeNull();
  });
});

describe("parseAircraftIdentityShard", () => {
  it("expands compact shard tuples into identity objects and ignores malformed entries", () => {
    expect(
      parseAircraftIdentityShard({
        abc123: ["N123AB", "B738", "Boeing", "737-800"],
        bad: ["too", "short"],
        XYZ999: ["bad", "icao24", "value", "ignored"]
      })
    ).toEqual({
      abc123: {
        registration: "N123AB",
        typeCode: "B738",
        manufacturer: "Boeing",
        model: "737-800"
      }
    });
  });
});

describe("deriveRenderModelKey", () => {
  it("keeps the Step 3 hook small and family-focused", () => {
    expect(deriveRenderModelKey("B738")).toBe("boeing-737-family");
    expect(deriveRenderModelKey("A20N")).toBe("airbus-a320-family");
    expect(deriveRenderModelKey("B77W")).toBe("boeing-777-family");
    expect(deriveRenderModelKey("DH8D")).toBeNull();
  });
});

describe("formatAircraftModelDescription", () => {
  it("combines manufacturer and model without duplicating the manufacturer", () => {
    expect(formatAircraftModelDescription("Boeing", "737-800")).toBe("Boeing 737-800");
    expect(formatAircraftModelDescription("Airbus", "Airbus A320-214")).toBe("Airbus A320-214");
  });
});
