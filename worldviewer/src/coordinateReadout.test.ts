import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatReadout,
  formatForClipboard,
  throttle,
  createReadoutController,
  type CursorPosition
} from "./coordinateReadout";

describe("coordinateReadout", () => {
  describe("formatReadout", () => {
    it("formats position with elevation", () => {
      const pos: CursorPosition = { lat: 55.9533, lng: -3.1883, elevation: 142 };
      expect(formatReadout(pos)).toBe("55.9533, -3.1883 · 142 m");
    });

    it("formats position with null elevation (terrain off)", () => {
      const pos: CursorPosition = { lat: 0, lng: 0, elevation: null };
      expect(formatReadout(pos)).toBe("0.0000, 0.0000");
    });

    it("formats negative coordinates (southern/western hemispheres)", () => {
      const pos: CursorPosition = { lat: -33.8688, lng: -151.2093, elevation: 58 };
      expect(formatReadout(pos)).toBe("-33.8688, -151.2093 · 58 m");
    });

    it("formats zero elevation as 0 m", () => {
      const pos: CursorPosition = { lat: 51.5074, lng: -0.1278, elevation: 0 };
      expect(formatReadout(pos)).toBe("51.5074, -0.1278 · 0 m");
    });

    it("rounds coordinates to 4 decimal places", () => {
      const pos: CursorPosition = { lat: 55.95336789, lng: -3.18829123, elevation: null };
      expect(formatReadout(pos)).toBe("55.9534, -3.1883");
    });

    it("rounds elevation to nearest integer", () => {
      const pos: CursorPosition = { lat: 10, lng: 20, elevation: 142.7 };
      expect(formatReadout(pos)).toBe("10.0000, 20.0000 · 143 m");
    });

    it("handles negative elevation (below sea level)", () => {
      const pos: CursorPosition = { lat: 31.5, lng: 35.5, elevation: -420 };
      expect(formatReadout(pos)).toBe("31.5000, 35.5000 · -420 m");
    });
  });

  describe("formatForClipboard", () => {
    it("formats coordinates without elevation", () => {
      expect(formatForClipboard(55.9533, -3.1883)).toBe("55.9533, -3.1883");
    });

    it("rounds coordinates to 4 decimal places", () => {
      expect(formatForClipboard(55.95336789, -3.18829123)).toBe("55.9534, -3.1883");
    });

    it("handles zero coordinates", () => {
      expect(formatForClipboard(0, 0)).toBe("0.0000, 0.0000");
    });
  });

  describe("throttle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("fires immediately on first call", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("suppresses calls within the throttle window", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("fires again after the throttle window expires", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      throttled();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("passes arguments to the underlying function", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled(42, "hello");

      expect(fn).toHaveBeenCalledWith(42, "hello");
    });

    it("suppresses at 99ms but fires at 100ms", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(99);
      throttled();
      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      throttled();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("createReadoutController", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("calls onUpdate with formatted string on handleMouseMove", () => {
      const getElevation = vi.fn(() => 142);
      const onUpdate = vi.fn();
      const controller = createReadoutController({ getElevation, onUpdate });

      controller.handleMouseMove({ lngLat: { lng: -3.1883, lat: 55.9533 } });

      expect(onUpdate).toHaveBeenCalledWith("55.9533, -3.1883 · 142 m");
    });

    it("calls getElevation with the lngLat from the event", () => {
      const getElevation = vi.fn(() => null);
      const onUpdate = vi.fn();
      const controller = createReadoutController({ getElevation, onUpdate });

      controller.handleMouseMove({ lngLat: { lng: 10, lat: 20 } });

      expect(getElevation).toHaveBeenCalledWith({ lng: 10, lat: 20 });
    });

    it("formats without elevation when getElevation returns null", () => {
      const getElevation = vi.fn(() => null);
      const onUpdate = vi.fn();
      const controller = createReadoutController({ getElevation, onUpdate });

      controller.handleMouseMove({ lngLat: { lng: 0, lat: 0 } });

      expect(onUpdate).toHaveBeenCalledWith("0.0000, 0.0000");
    });

    it("throttles rapid mousemove events", () => {
      const getElevation = vi.fn(() => 100);
      const onUpdate = vi.fn();
      const controller = createReadoutController({ getElevation, onUpdate });

      controller.handleMouseMove({ lngLat: { lng: 1, lat: 1 } });
      controller.handleMouseMove({ lngLat: { lng: 2, lat: 2 } });
      controller.handleMouseMove({ lngLat: { lng: 3, lat: 3 } });

      // Only the first call fires due to throttle
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith("1.0000, 1.0000 · 100 m");
    });

    it("fires again after throttle window expires", () => {
      const getElevation = vi.fn(() => 100);
      const onUpdate = vi.fn();
      const controller = createReadoutController({ getElevation, onUpdate });

      controller.handleMouseMove({ lngLat: { lng: 1, lat: 1 } });
      expect(onUpdate).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      controller.handleMouseMove({ lngLat: { lng: 2, lat: 2 } });
      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onUpdate).toHaveBeenLastCalledWith("2.0000, 2.0000 · 100 m");
    });

    it("dispose prevents further onUpdate calls", () => {
      const getElevation = vi.fn(() => 100);
      const onUpdate = vi.fn();
      const controller = createReadoutController({ getElevation, onUpdate });

      controller.handleMouseMove({ lngLat: { lng: 1, lat: 1 } });
      expect(onUpdate).toHaveBeenCalledTimes(1);

      controller.dispose();

      vi.advanceTimersByTime(100);
      controller.handleMouseMove({ lngLat: { lng: 2, lat: 2 } });
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
