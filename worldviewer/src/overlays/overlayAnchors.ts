export type OverlayAnchorLayer = {
  id: string;
  type: string;
  source?: string;
  layout?: Record<string, unknown>;
};

const KNOWN_LABEL_LAYER_IDS = [
  "label_other",
  "label_village",
  "label_town",
  "label_state",
  "label_city",
  "label_city_capital",
  "label_country_3",
  "label_country_2",
  "label_country_1",
  "poi_r20",
  "poi_r7",
  "poi_r1",
  "poi_transit",
  "waterway_line_label",
  "water_name_point_label",
  "water_name_line_label",
  "road_shield_us"
] as const;

const KNOWN_SATELLITE_LAYER_IDS = ["satellite-imagery"] as const;
const KNOWN_ROAD_LAYER_IDS = [
  "road_motorway",
  "road_trunk_primary",
  "road_secondary_tertiary",
  "road_minor"
] as const;

export function findFirstLabelLayerId(layers: readonly OverlayAnchorLayer[]): string | undefined {
  return findFirstMatchingLayerId(
    layers,
    (layer) => KNOWN_LABEL_LAYER_ID_SET.has(layer.id) || isLabelLikeLayer(layer)
  );
}

export function findSatelliteImageryLayerId(layers: readonly OverlayAnchorLayer[]): string | undefined {
  return findFirstMatchingLayerId(
    layers,
    (layer) =>
      layer.type === "raster" &&
      (KNOWN_SATELLITE_LAYER_ID_SET.has(layer.id) || isSatelliteLikeLayer(layer))
  );
}

export function findFirstRoadLayerId(layers: readonly OverlayAnchorLayer[]): string | undefined {
  return findFirstMatchingLayerId(
    layers,
    (layer) => layer.type === "line" && (KNOWN_ROAD_LAYER_ID_SET.has(layer.id) || /road/i.test(layer.id))
  );
}

export function findFirstNonBaseContentLayerId(
  layers: readonly OverlayAnchorLayer[]
): string | undefined {
  let lastBaseObscuringLayerIndex = -1;

  for (const [index, layer] of layers.entries()) {
    if (BASE_OBSCURING_LAYER_TYPE_SET.has(layer.type)) {
      lastBaseObscuringLayerIndex = index;
    }
  }

  return layers[lastBaseObscuringLayerIndex + 1]?.id;
}

const KNOWN_LABEL_LAYER_ID_SET = new Set<string>(KNOWN_LABEL_LAYER_IDS);
const KNOWN_SATELLITE_LAYER_ID_SET = new Set<string>(KNOWN_SATELLITE_LAYER_IDS);
const KNOWN_ROAD_LAYER_ID_SET = new Set<string>(KNOWN_ROAD_LAYER_IDS);
const BASE_OBSCURING_LAYER_TYPE_SET = new Set<string>([
  "background",
  "fill",
  "fill-extrusion",
  "hillshade",
  "raster"
]);

function findFirstMatchingLayerId(
  layers: readonly OverlayAnchorLayer[],
  matches: (layer: OverlayAnchorLayer) => boolean
): string | undefined {
  return layers.find((layer) => matches(layer))?.id;
}

function isLabelLikeLayer(layer: OverlayAnchorLayer): boolean {
  if (layer.type !== "symbol") {
    return false;
  }

  return "text-field" in (layer.layout ?? {}) || /(label|place|poi|shield|name)/i.test(layer.id);
}

function isSatelliteLikeLayer(layer: OverlayAnchorLayer): boolean {
  return layer.source === "satellite" || /(satellite|imagery)/i.test(layer.id);
}
