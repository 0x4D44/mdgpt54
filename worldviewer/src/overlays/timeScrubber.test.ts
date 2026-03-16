import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatScrubberLabel,
  dateFromSliderValue,
  sliderValueFromDate,
  createTimeScrubber
} from "./timeScrubber";

describe("timeScrubber", () => {
  describe("formatScrubberLabel", () => {
    it("formats a UTC date as YYYY-MM-DD HH:MM UTC", () => {
      const date = new Date("2026-03-16T14:30:00Z");
      expect(formatScrubberLabel(date)).toBe("2026-03-16 14:30 UTC");
    });

    it("zero-pads single-digit months, days, hours, and minutes", () => {
      const date = new Date("2026-01-05T03:07:00Z");
      expect(formatScrubberLabel(date)).toBe("2026-01-05 03:07 UTC");
    });

    it("handles midnight correctly", () => {
      const date = new Date("2026-12-31T00:00:00Z");
      expect(formatScrubberLabel(date)).toBe("2026-12-31 00:00 UTC");
    });

    it("handles end of day correctly", () => {
      const date = new Date("2026-06-15T23:59:00Z");
      expect(formatScrubberLabel(date)).toBe("2026-06-15 23:59 UTC");
    });
  });

  describe("dateFromSliderValue", () => {
    it("returns midnight UTC for value 0", () => {
      const date = dateFromSliderValue(0);
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
    });

    it("returns noon UTC for value 720", () => {
      const date = dateFromSliderValue(720);
      expect(date.getUTCHours()).toBe(12);
      expect(date.getUTCMinutes()).toBe(0);
    });

    it("returns next midnight for value 1440", () => {
      const date = dateFromSliderValue(1440);
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
    });

    it("handles fractional hours (e.g. 90 = 01:30)", () => {
      const date = dateFromSliderValue(90);
      expect(date.getUTCHours()).toBe(1);
      expect(date.getUTCMinutes()).toBe(30);
    });

    it("uses today's UTC date", () => {
      const now = new Date();
      const date = dateFromSliderValue(0);
      expect(date.getUTCFullYear()).toBe(now.getUTCFullYear());
      expect(date.getUTCMonth()).toBe(now.getUTCMonth());
      expect(date.getUTCDate()).toBe(now.getUTCDate());
    });
  });

  describe("sliderValueFromDate", () => {
    it("returns 0 for midnight UTC", () => {
      const date = new Date("2026-03-16T00:00:00Z");
      expect(sliderValueFromDate(date)).toBe(0);
    });

    it("returns 720 for noon UTC", () => {
      const date = new Date("2026-03-16T12:00:00Z");
      expect(sliderValueFromDate(date)).toBe(720);
    });

    it("returns 1439 for 23:59 UTC", () => {
      const date = new Date("2026-03-16T23:59:00Z");
      expect(sliderValueFromDate(date)).toBe(1439);
    });

    it("round-trips with dateFromSliderValue", () => {
      for (const value of [0, 1, 60, 360, 720, 1080, 1439, 1440]) {
        const date = dateFromSliderValue(value);
        const roundTripped = sliderValueFromDate(date);
        // 1440 wraps to 0 (next midnight = midnight)
        const expected = value === 1440 ? 0 : value;
        expect(roundTripped).toBe(expected);
      }
    });
  });

  describe("createTimeScrubber", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts in live mode with null overrideDate", () => {
      const scrubber = createTimeScrubber({ onDateChange: vi.fn() });
      expect(scrubber.getState().overrideDate).toBeNull();
    });

    it("getDate returns current time in live mode", () => {
      vi.setSystemTime(new Date("2026-03-16T14:30:00Z"));
      const scrubber = createTimeScrubber({ onDateChange: vi.fn() });
      const date = scrubber.getDate();
      expect(date.toISOString()).toBe("2026-03-16T14:30:00.000Z");
    });

    it("setOverride switches to frozen mode", () => {
      const onDateChange = vi.fn();
      const scrubber = createTimeScrubber({ onDateChange });
      const frozenDate = new Date("2026-06-21T12:00:00Z");

      scrubber.setOverride(frozenDate);

      expect(scrubber.getState().overrideDate).toEqual(frozenDate);
      expect(scrubber.getDate()).toEqual(frozenDate);
      expect(onDateChange).toHaveBeenCalledWith(frozenDate);
    });

    it("getDate returns the frozen date after setOverride", () => {
      vi.setSystemTime(new Date("2026-03-16T14:30:00Z"));
      const scrubber = createTimeScrubber({ onDateChange: vi.fn() });
      const frozenDate = new Date("2026-06-21T12:00:00Z");

      scrubber.setOverride(frozenDate);

      // Even though system time is different, getDate returns the frozen time
      expect(scrubber.getDate().toISOString()).toBe("2026-06-21T12:00:00.000Z");
    });

    it("resetToLive returns to live mode", () => {
      const onDateChange = vi.fn();
      const scrubber = createTimeScrubber({ onDateChange });
      const frozenDate = new Date("2026-06-21T12:00:00Z");

      scrubber.setOverride(frozenDate);
      scrubber.resetToLive();

      expect(scrubber.getState().overrideDate).toBeNull();
      expect(onDateChange).toHaveBeenLastCalledWith(null);
    });

    it("getDate returns current time after resetToLive", () => {
      vi.setSystemTime(new Date("2026-03-16T14:30:00Z"));
      const scrubber = createTimeScrubber({ onDateChange: vi.fn() });

      scrubber.setOverride(new Date("2026-06-21T12:00:00Z"));
      scrubber.resetToLive();

      expect(scrubber.getDate().toISOString()).toBe("2026-03-16T14:30:00.000Z");
    });

    it("multiple setOverride calls update the frozen date", () => {
      const onDateChange = vi.fn();
      const scrubber = createTimeScrubber({ onDateChange });

      scrubber.setOverride(new Date("2026-01-01T00:00:00Z"));
      scrubber.setOverride(new Date("2026-12-31T23:59:00Z"));

      expect(scrubber.getDate().toISOString()).toBe("2026-12-31T23:59:00.000Z");
      expect(onDateChange).toHaveBeenCalledTimes(2);
    });
  });
});
