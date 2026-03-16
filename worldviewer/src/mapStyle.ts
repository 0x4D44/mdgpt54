import type { StyleSpecification } from "maplibre-gl";
import {
  CONTOUR_THRESHOLDS,
  CONTOUR_SOURCE_ID,
  RELIEF_DEM_SOURCE_ID,
  TERRAIN_MESH_SOURCE_ID,
  getHillshadeExaggerationExpression,
  getSatelliteOpacity
} from "./reliefProfile";

type StyleSource = {
  type: string;
  [key: string]: unknown;
};

type StyleLayer = {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
};

type StyleSpec = {
  version: 8;
  name?: string;
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  sprite?: string;
  glyphs?: string;
  metadata?: Record<string, unknown>;
  sources: Record<string, StyleSource>;
  layers: StyleLayer[];
  projection?: { type: "globe" | "mercator" };
  terrain?: { source: string; exaggeration?: number };
  sky?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DemSourceLike = {
  sharedDemProtocolUrl: string;
  contourProtocolUrl(options: {
    thresholds: Record<number, number[]>;
    contourLayer: string;
    elevationKey: string;
    levelKey: string;
  }): string;
};

export type StyleBuildConfig = {
  reliefEnabled: boolean;
  terrainExaggeration: number;
};

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const TERRAIN_ATTRIBUTION =
  'Terrain &copy; <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> / <a href="https://github.com/tilezen/joerd/blob/master/docs/formats.md#terrarium">Terrarium</a>';

export const BUILDING_LAYER_ID = "building-3d";
export const FLAT_BUILDING_LAYER_ID = "building";

const HILLSHADE_LAYER_ID = "terrain-hillshade";
const CONTOUR_LINE_LAYER_ID = "terrain-contours-line";
const CONTOUR_LABEL_LAYER_ID = "terrain-contours-label";
const LABEL_LAYER_IDS = [
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

export async function buildMapStyle(
  demSource: DemSourceLike,
  config: StyleBuildConfig
): Promise<StyleSpecification> {
  const response = await fetch(OPENFREEMAP_STYLE_URL);
  if (!response.ok) {
    throw new Error(`Style request failed with ${response.status}.`);
  }

  const baseStyle = (await response.json()) as StyleSpec;
  const sources: Record<string, StyleSource> = {
    ...baseStyle.sources,
    satellite: {
      type: "raster",
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Imagery &copy; <a href="https://maps.eox.at/">EOX Maps</a>'
    },
    [TERRAIN_MESH_SOURCE_ID]: {
      type: "raster-dem",
      tiles: [demSource.sharedDemProtocolUrl],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
      attribution: TERRAIN_ATTRIBUTION
    },
    [RELIEF_DEM_SOURCE_ID]: {
      type: "raster-dem",
      tiles: [demSource.sharedDemProtocolUrl],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
      attribution: TERRAIN_ATTRIBUTION
    },
    [CONTOUR_SOURCE_ID]: {
      type: "vector",
      tiles: [
        demSource.contourProtocolUrl({
          thresholds: CONTOUR_THRESHOLDS,
          contourLayer: "contours",
          elevationKey: "ele",
          levelKey: "level"
        })
      ],
      maxzoom: 15,
      attribution: 'Contours via <a href="https://github.com/onthegomap/maplibre-contour">maplibre-contour</a>'
    }
  };

  const transformedLayers = baseStyle.layers.map((layer) => {
    const nextLayer: StyleLayer = {
      ...layer
    };

    if (layer.layout) {
      nextLayer.layout = { ...layer.layout };
    }

    if (layer.paint) {
      nextLayer.paint = { ...layer.paint };
    }

    if (nextLayer.id === "background") {
      nextLayer.paint = {
        ...(nextLayer.paint ?? {}),
        "background-color": "#050b14"
      };
    }

    if (nextLayer.id === "natural_earth" && nextLayer.paint) {
      nextLayer.paint["raster-opacity"] = [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.12,
        4,
        0.06,
        6,
        0
      ];
    }

    if (nextLayer.type === "fill" && nextLayer.id !== FLAT_BUILDING_LAYER_ID && nextLayer.paint) {
      nextLayer.paint["fill-opacity"] = selectFillOpacity(nextLayer.id);
    }

    if (nextLayer.id === BUILDING_LAYER_ID && nextLayer.paint) {
      nextLayer.paint["fill-extrusion-color"] = [
        "interpolate",
        ["linear"],
        ["get", "render_height"],
        0,
        "#d8d3cc",
        120,
        "#b9b4ae",
        300,
        "#9d9a96"
      ];
      nextLayer.paint["fill-extrusion-opacity"] = 0.86;
    }

    if (nextLayer.id === FLAT_BUILDING_LAYER_ID && nextLayer.paint) {
      nextLayer.paint["fill-opacity"] = [
        "interpolate",
        ["linear"],
        ["zoom"],
        13,
        0.18,
        14,
        0.3
      ];
      nextLayer.paint["fill-outline-color"] = "rgba(255,255,255,0.18)";
    }

    if (LABEL_LAYER_IDS.includes(nextLayer.id as (typeof LABEL_LAYER_IDS)[number]) && nextLayer.paint) {
      nextLayer.paint["text-halo-color"] = "rgba(13, 17, 24, 0.88)";
      nextLayer.paint["text-halo-width"] = 1.2;
      nextLayer.paint["text-color"] = "#f7fafc";
    }

    if (nextLayer.type === "line" && nextLayer.id.startsWith("road_") && nextLayer.paint) {
      nextLayer.paint["line-opacity"] = selectRoadOpacity(nextLayer.id);
    }

    return nextLayer;
  });

  const satelliteLayer: StyleLayer = {
    id: "satellite-imagery",
    type: "raster",
    source: "satellite",
    maxzoom: 17,
    paint: {
      "raster-saturation": -0.28,
      "raster-contrast": 0.24,
      "raster-brightness-min": 0.05,
      "raster-brightness-max": 0.88,
      "raster-opacity": getSatelliteOpacity(1.2, 0, config.reliefEnabled)
    }
  };

  const hillshadeLayer: StyleLayer = {
    id: HILLSHADE_LAYER_ID,
    type: "hillshade",
    source: RELIEF_DEM_SOURCE_ID,
    minzoom: 6,
    paint: {
      "hillshade-exaggeration": getHillshadeExaggerationExpression(),
      "hillshade-shadow-color": "rgba(10, 16, 24, 0.7)",
      "hillshade-highlight-color": "rgba(255, 244, 214, 0.52)",
      "hillshade-accent-color": "rgba(255, 255, 255, 0.24)",
      "hillshade-illumination-direction": 315,
      "hillshade-illumination-anchor": "viewport"
    }
  };

  const contourLineLayer: StyleLayer = {
    id: CONTOUR_LINE_LAYER_ID,
    type: "line",
    source: CONTOUR_SOURCE_ID,
    "source-layer": "contours",
    minzoom: 9.5,
    layout: {
      "line-join": "round"
    },
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "level"], 1],
        "rgba(255, 245, 210, 0.72)",
        "rgba(255, 255, 255, 0.32)"
      ],
      "line-opacity": [
        "case",
        ["==", ["get", "level"], 1],
        0.85,
        0.42
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9.5,
        0.55,
        12,
        0.9,
        14,
        1.4
      ]
    }
  };

  const contourLabelLayer: StyleLayer = {
    id: CONTOUR_LABEL_LAYER_ID,
    type: "symbol",
    source: CONTOUR_SOURCE_ID,
    "source-layer": "contours",
    minzoom: 10.8,
    filter: ["==", ["get", "level"], 1],
    layout: {
      "symbol-placement": "line",
      "text-field": ["concat", ["to-string", ["get", "ele"]], " m"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10.5
    },
    paint: {
      "text-color": "rgba(255,248,224,0.84)",
      "text-halo-color": "rgba(13, 17, 24, 0.82)",
      "text-halo-width": 1.1
    }
  };

  const layers = [
    transformedLayers[0],
    satelliteLayer,
    hillshadeLayer,
    ...transformedLayers.slice(1)
  ];

  const contourInsertIndex = layers.findIndex((layer) => layer.id === "road_area_pattern");
  if (contourInsertIndex >= 0) {
    layers.splice(contourInsertIndex, 0, contourLineLayer, contourLabelLayer);
  } else {
    layers.push(contourLineLayer, contourLabelLayer);
  }

  return {
    ...baseStyle,
    projection: { type: "globe" },
    sources,
    layers,
    terrain: {
      source: TERRAIN_MESH_SOURCE_ID,
      exaggeration: config.terrainExaggeration
    }
  } as unknown as StyleSpecification;
}

export function selectFillOpacity(layerId: string): number | unknown[] {
  if (layerId === "water") {
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.25,
      8,
      0.2,
      14,
      0.08
    ];
  }

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.08,
    10,
    0.05,
    14,
    0.02
  ];
}

export function selectRoadOpacity(layerId: string): number | unknown[] {
  if (layerId.includes("casing")) {
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      0,
      10,
      0.22,
      16,
      0.45
    ];
  }

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    5,
    0,
    10,
    0.35,
    16,
    0.72
  ];
}
