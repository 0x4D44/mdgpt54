export const AIRCRAFT_ICON_SIZE = 48;
export const AIRCRAFT_ICON_PIXEL_RATIO = 2;
const AIRCRAFT_ICON_MIN_SCALE = 0.42;
const AIRCRAFT_ICON_MID_SCALE = 0.48;
export const AIRCRAFT_ICON_MAX_SCALE = 0.58;
const AIRCRAFT_ICON_BASE_SCREEN_SIZE_PX = AIRCRAFT_ICON_SIZE / AIRCRAFT_ICON_PIXEL_RATIO;

export const AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX = AIRCRAFT_ICON_BASE_SCREEN_SIZE_PX * AIRCRAFT_ICON_MAX_SCALE;

export function aircraftIconSizeExpression(): [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  0.42,
  8,
  0.48,
  12,
  0.58
] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    5,
    AIRCRAFT_ICON_MIN_SCALE,
    8,
    AIRCRAFT_ICON_MID_SCALE,
    12,
    AIRCRAFT_ICON_MAX_SCALE
  ];
}
