export const SHIP_ICON_SIZE = 48;
export const SHIP_ICON_PIXEL_RATIO = 2;
export const SHIP_ICON_NAME = "ship-generic";
export const SHIP_WAKE_ICON_NAME = "ship-wake";

type ShipIconImage = ImageData | { width: number; height: number; data: Uint8ClampedArray };

/** Draw a top-down ship hull silhouette on a canvas, returning ImageData for MapLibre. */
export function createShipIcon(): ShipIconImage {
  const canvas = document.createElement("canvas");
  canvas.width = SHIP_ICON_SIZE;
  canvas.height = SHIP_ICON_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    return {
      width: SHIP_ICON_SIZE,
      height: SHIP_ICON_SIZE,
      data: new Uint8ClampedArray(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4)
    };
  }

  context.clearRect(0, 0, SHIP_ICON_SIZE, SHIP_ICON_SIZE);
  context.translate(SHIP_ICON_SIZE / 2, SHIP_ICON_SIZE / 2);
  context.fillStyle = "#ffffff";
  context.strokeStyle = "rgba(5, 11, 20, 0.92)";
  context.lineWidth = 2.0;
  context.lineJoin = "round";
  context.lineCap = "round";

  // Top-down ship hull: pointed bow (top), wider mid-section, flat stern (bottom).
  // Oriented nose-up so icon-rotate = heading works directly.
  drawClosedShape(context, [
    [0, -20], // bow tip
    [5, -14], // bow shoulder right
    [7, -6], // forward hull right
    [7, 6], // mid hull right
    [6, 14], // aft hull right
    [5, 18], // stern corner right
    [-5, 18], // stern corner left
    [-6, 14], // aft hull left
    [-7, 6], // mid hull left
    [-7, -6], // forward hull left
    [-5, -14] // bow shoulder left
  ]);

  return context.getImageData(0, 0, SHIP_ICON_SIZE, SHIP_ICON_SIZE);
}

/** Draw a V-shaped wake trail icon for rendering behind moving ships. */
export function createWakeIcon(): ShipIconImage {
  const canvas = document.createElement("canvas");
  canvas.width = SHIP_ICON_SIZE;
  canvas.height = SHIP_ICON_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    return {
      width: SHIP_ICON_SIZE,
      height: SHIP_ICON_SIZE,
      data: new Uint8ClampedArray(SHIP_ICON_SIZE * SHIP_ICON_SIZE * 4)
    };
  }

  context.clearRect(0, 0, SHIP_ICON_SIZE, SHIP_ICON_SIZE);
  context.translate(SHIP_ICON_SIZE / 2, SHIP_ICON_SIZE / 2);
  context.fillStyle = "rgba(255, 255, 255, 0.6)";
  context.strokeStyle = "rgba(255, 255, 255, 0.3)";
  context.lineWidth = 1.5;
  context.lineJoin = "round";
  context.lineCap = "round";

  // V-shaped wake: narrow at the top (just behind the ship), spreading toward the bottom.
  // Anchor "top" places the top of the icon at the ship's position.
  drawClosedShape(context, [
    [0, -20], // wake origin (just behind ship)
    [10, 18], // right arm of V
    [6, 18], // inner right
    [0, -10], // inner apex
    [-6, 18], // inner left
    [-10, 18] // left arm of V
  ]);

  return context.getImageData(0, 0, SHIP_ICON_SIZE, SHIP_ICON_SIZE);
}

/** Zoom-based icon size expression for ships (similar to aircraft). */
export function shipIconSizeExpression(): [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  number,
  8,
  number,
  12,
  number
] {
  return ["interpolate", ["linear"], ["zoom"], 5, 0.38, 8, 0.44, 12, 0.54];
}

/** Speed-based wake size expression — scales wake with speedKnots, zero speed = no wake. */
export function shipWakeSizeExpression(): [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "speedKnots"], 0],
  0,
  0,
  5,
  number,
  15,
  number
] {
  return ["interpolate", ["linear"], ["coalesce", ["get", "speedKnots"], 0], 0, 0, 5, 0.3, 15, 0.6];
}

function drawClosedShape(context: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
  context.fill();
  context.stroke();
}
