import { describe, expect, it, vi } from "vitest";

import { createShipIcon, createWakeIcon, SHIP_ICON_SIZE, shipIconSizeExpression, shipWakeSizeExpression } from "./shipIcons";

describe("createShipIcon", () => {
  it("returns correctly sized image data", () => {
    const mockContext = {
      clearRect: vi.fn(),
      translate: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineJoin: "",
      lineCap: "",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      getImageData: vi.fn(() => ({
        width: SHIP_ICON_SIZE,
        height: SHIP_ICON_SIZE,
        data: new Uint8ClampedArray(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4)
      }))
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockContext)
      }))
    });

    const icon = createShipIcon();

    expect(icon.width).toBe(SHIP_ICON_SIZE);
    expect(icon.height).toBe(SHIP_ICON_SIZE);
    expect(icon.data).toBeInstanceOf(Uint8ClampedArray);
    expect(icon.data).toHaveLength(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4);

    vi.unstubAllGlobals();
  });

  it("draws a closed hull shape with fill and stroke", () => {
    const mockContext = {
      clearRect: vi.fn(),
      translate: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineJoin: "",
      lineCap: "",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      getImageData: vi.fn(() => ({
        width: SHIP_ICON_SIZE,
        height: SHIP_ICON_SIZE,
        data: new Uint8ClampedArray(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4)
      }))
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockContext)
      }))
    });

    createShipIcon();

    expect(mockContext.beginPath).toHaveBeenCalled();
    expect(mockContext.moveTo).toHaveBeenCalled();
    expect(mockContext.lineTo).toHaveBeenCalled();
    expect(mockContext.closePath).toHaveBeenCalled();
    expect(mockContext.fill).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("falls back to transparent image data when canvas 2d is unavailable", () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => null)
      }))
    });

    const icon = createShipIcon();

    expect(icon.width).toBe(SHIP_ICON_SIZE);
    expect(icon.height).toBe(SHIP_ICON_SIZE);
    expect(icon.data).toBeInstanceOf(Uint8ClampedArray);
    expect(icon.data).toHaveLength(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4);
    // All pixels transparent
    expect(icon.data.every((v) => v === 0)).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("createWakeIcon", () => {
  it("returns correctly sized image data", () => {
    const mockContext = {
      clearRect: vi.fn(),
      translate: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineJoin: "",
      lineCap: "",
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      getImageData: vi.fn(() => ({
        width: SHIP_ICON_SIZE,
        height: SHIP_ICON_SIZE,
        data: new Uint8ClampedArray(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4)
      }))
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockContext)
      }))
    });

    const icon = createWakeIcon();

    expect(icon.width).toBe(SHIP_ICON_SIZE);
    expect(icon.height).toBe(SHIP_ICON_SIZE);
    expect(icon.data).toBeInstanceOf(Uint8ClampedArray);
    expect(icon.data).toHaveLength(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4);

    vi.unstubAllGlobals();
  });

  it("falls back to transparent image data when canvas 2d is unavailable", () => {
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => null)
      }))
    });

    const icon = createWakeIcon();

    expect(icon.width).toBe(SHIP_ICON_SIZE);
    expect(icon.height).toBe(SHIP_ICON_SIZE);
    expect(icon.data.every((v) => v === 0)).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("shipIconSizeExpression", () => {
  it("returns a valid interpolate expression", () => {
    const expr = shipIconSizeExpression();

    expect(expr[0]).toBe("interpolate");
    expect(expr[1]).toEqual(["linear"]);
    expect(expr[2]).toEqual(["zoom"]);
    // Should have zoom stops (pairs after the first 3 elements)
    expect(expr.length).toBeGreaterThanOrEqual(7);
    // Zoom stops should be numbers
    for (let i = 3; i < expr.length; i += 2) {
      expect(typeof expr[i]).toBe("number");
      expect(typeof expr[i + 1]).toBe("number");
    }
  });
});

describe("shipWakeSizeExpression", () => {
  it("returns a valid interpolate expression over speedKnots", () => {
    const expr = shipWakeSizeExpression();

    expect(expr[0]).toBe("interpolate");
    expect(expr[1]).toEqual(["linear"]);
    expect(expr[2]).toEqual(["coalesce", ["get", "speedKnots"], 0]);
    // Should have speed stops
    expect(expr.length).toBeGreaterThanOrEqual(7);
  });

  it("maps speed 0 to size 0", () => {
    const expr = shipWakeSizeExpression();

    // First speed stop should be 0 → 0
    expect(expr[3]).toBe(0);
    expect(expr[4]).toBe(0);
  });
});
