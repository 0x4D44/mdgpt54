import { describe, expect, it } from "vitest";

import { parseHash, serializeHash, roundForHash, DEFAULTS, type CameraHashState } from "./cameraHash";

describe("cameraHash", () => {
  describe("parseHash", () => {
    it("returns empty object for empty string", () => {
      expect(parseHash("")).toEqual({});
    });

    it("returns empty object for bare hash", () => {
      expect(parseHash("#")).toEqual({});
    });

    it("parses camera values correctly", () => {
      expect(parseHash("#lat=55.95&lng=-3.19&z=14.8")).toEqual({
        lat: 55.95,
        lng: -3.19,
        z: 14.8
      });
    });

    it("parses pitch and bearing", () => {
      expect(parseHash("#p=68&b=-20")).toEqual({
        p: 68,
        b: -20
      });
    });

    it("parses all camera values together", () => {
      expect(parseHash("#lat=55.9533&lng=-3.1883&z=14.8&p=68&b=-20")).toEqual({
        lat: 55.9533,
        lng: -3.1883,
        z: 14.8,
        p: 68,
        b: -20
      });
    });

    it("parses boolean toggles as 1/0", () => {
      expect(parseHash("#terrain=0&night=1")).toEqual({
        terrain: false,
        night: true
      });
    });

    it("parses all boolean toggles", () => {
      expect(parseHash("#terrain=0&night=1&weather=1&relief=0&buildings=0&spin=0")).toEqual({
        terrain: false,
        night: true,
        weather: true,
        relief: false,
        buildings: false,
        spin: false
      });
    });

    it("ignores unknown keys", () => {
      expect(parseHash("#lat=10&foo=bar&baz=42")).toEqual({ lat: 10 });
    });

    it("ignores malformed numeric values (NaN)", () => {
      expect(parseHash("#lat=abc&z=14.8")).toEqual({ z: 14.8 });
    });

    it("ignores empty values", () => {
      expect(parseHash("#lat=&z=14.8")).toEqual({ z: 14.8 });
    });

    it("ignores boolean keys with non-0/1 values", () => {
      expect(parseHash("#terrain=yes&night=0")).toEqual({ night: false });
    });

    it("parses mixed camera and toggle values", () => {
      expect(parseHash("#lat=55.95&terrain=0&z=14.8&night=1")).toEqual({
        lat: 55.95,
        z: 14.8,
        terrain: false,
        night: true
      });
    });

    it("clamps latitude above 90 to 90", () => {
      expect(parseHash("#lat=999")).toEqual({ lat: 90 });
    });

    it("clamps latitude below -90 to -90", () => {
      expect(parseHash("#lat=-999")).toEqual({ lat: -90 });
    });

    it("clamps negative zoom to 0", () => {
      expect(parseHash("#z=-5")).toEqual({ z: 0 });
    });

    it("clamps pitch above 85 to 85", () => {
      expect(parseHash("#p=200")).toEqual({ p: 85 });
    });

    it("clamps bearing above 180 to 180", () => {
      expect(parseHash("#b=9999")).toEqual({ b: 180 });
    });

    it("rejects script-injection numeric values as NaN", () => {
      expect(parseHash("#lat=55<script>")).toEqual({});
    });

    it("rejects Infinity as non-finite", () => {
      expect(parseHash("#lat=Infinity")).toEqual({});
    });
  });

  describe("serializeHash", () => {
    it("returns empty string when all values match defaults", () => {
      expect(
        serializeHash({
          lat: 21,
          lng: 12,
          z: 1.2,
          p: 0,
          b: -10,
          terrain: true,
          buildings: true,
          relief: true,
          night: true,
          weather: false,
          spin: true
        })
      ).toBe("");
    });

    it("returns empty string for empty state", () => {
      expect(serializeHash({})).toBe("");
    });

    it("omits keys that match defaults", () => {
      const hash = serializeHash({ lat: 55.95, lng: -3.19, z: 1.2 });
      // z=1.2 matches default, should be omitted
      expect(hash).toBe("#lat=55.95&lng=-3.19");
    });

    it("serializes non-default camera values", () => {
      const hash = serializeHash({ lat: 55.9533, lng: -3.1883, z: 14.8, p: 68, b: -20 });
      expect(hash).toBe("#lat=55.9533&lng=-3.1883&z=14.8&p=68&b=-20");
    });

    it("serializes non-default boolean toggles as 1/0", () => {
      const hash = serializeHash({ terrain: false, night: false });
      expect(hash).toBe("#terrain=0&night=0");
    });

    it("omits default boolean toggles", () => {
      // terrain defaults to true, weather defaults to false
      const hash = serializeHash({ terrain: true, weather: false });
      expect(hash).toBe("");
    });

    it("serializes non-default weather as 1", () => {
      const hash = serializeHash({ weather: true });
      expect(hash).toBe("#weather=1");
    });

    it("maintains consistent key order", () => {
      const hash = serializeHash({
        spin: false,
        b: -20,
        lat: 55.95,
        z: 14.8,
        terrain: false,
        lng: -3.19,
        p: 68
      });
      // Camera keys come first in canonical order, then toggles
      expect(hash).toBe("#lat=55.95&lng=-3.19&z=14.8&p=68&b=-20&terrain=0&spin=0");
    });
  });

  describe("roundForHash", () => {
    it("rounds to specified decimals", () => {
      expect(roundForHash(55.95336, 4)).toBe(55.9534);
      expect(roundForHash(-3.18829, 4)).toBe(-3.1883);
    });

    it("rounds zoom to 1 decimal", () => {
      expect(roundForHash(14.832, 1)).toBe(14.8);
    });

    it("rounds pitch/bearing to 0 decimals", () => {
      expect(roundForHash(67.6, 0)).toBe(68);
      expect(roundForHash(-19.4, 0)).toBe(-19);
      expect(roundForHash(-20.3, 0)).toBe(-20);
    });

    it("preserves exact values that need no rounding", () => {
      expect(roundForHash(55.9533, 4)).toBe(55.9533);
    });
  });

  describe("DEFAULTS", () => {
    it("keeps DEFAULTS in sync with the Earthrise preset initial camera", () => {
      // These must match PRESETS[0] ("Earthrise") in main.ts
      expect(DEFAULTS.lat).toBe(21);
      expect(DEFAULTS.lng).toBe(12);
      expect(DEFAULTS.z).toBe(1.2);
      expect(DEFAULTS.p).toBe(0);
      expect(DEFAULTS.b).toBe(-10);
    });
  });

  describe("round-trip", () => {
    it("reproduces state within rounding tolerance", () => {
      const original: CameraHashState = {
        lat: 55.95336,
        lng: -3.18829,
        z: 14.832,
        p: 67.6,
        b: -20.3,
        terrain: false,
        night: true,
        weather: true,
        relief: false,
        buildings: false,
        spin: false
      };

      const hash = serializeHash(original);
      const parsed = parseHash(hash);

      // Camera values rounded to their respective precisions
      expect(parsed.lat).toBeCloseTo(55.9534, 4);
      expect(parsed.lng).toBeCloseTo(-3.1883, 4);
      expect(parsed.z).toBeCloseTo(14.8, 1);
      expect(parsed.p).toBe(68);
      expect(parsed.b).toBe(-20);

      // Boolean toggles: non-default values are preserved, defaults are omitted
      expect(parsed.terrain).toBe(false);
      expect(parsed.night).toBeUndefined(); // true is default, so omitted
      expect(parsed.weather).toBe(true);
      expect(parsed.relief).toBe(false);
      expect(parsed.buildings).toBe(false);
      expect(parsed.spin).toBe(false);
    });

    it("round-trips default state to empty hash and back to empty object", () => {
      const defaultState: CameraHashState = {
        lat: 21,
        lng: 12,
        z: 1.2,
        p: 0,
        b: -10,
        terrain: true,
        buildings: true,
        relief: true,
        night: true,
        weather: false,
        spin: true
      };

      const hash = serializeHash(defaultState);
      expect(hash).toBe("");

      const parsed = parseHash(hash);
      expect(parsed).toEqual({});
    });
  });
});
