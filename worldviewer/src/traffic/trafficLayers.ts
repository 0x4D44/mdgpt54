import { type Map, Popup } from "maplibre-gl";

import { escapeHtml } from "../escapeHtml";
import {
  buildAircraftPopupIdentity,
  formatAge,
  formatAircraftAltitude,
  formatSpeed,
  tracksToGeoJSON,
  type AircraftVisualCategory
} from "./trafficHelpers";
import type { LiveTrack, SnapshotMessage } from "./trafficTypes";

export const AIRCRAFT_SOURCE = "live-aircraft";
export const SHIPS_SOURCE = "live-ships";

const AIRCRAFT_LAYER = "live-aircraft-points";
const AIRCRAFT_CLUSTER_LAYER = "live-aircraft-clusters";
const AIRCRAFT_CLUSTER_COUNT = "live-aircraft-cluster-count";
const SHIPS_LAYER = "live-ships-points";
const SHIPS_CLUSTER_LAYER = "live-ships-clusters";
const SHIPS_CLUSTER_COUNT = "live-ships-cluster-count";

const CLUSTER_RADIUS = 40;
const CLUSTER_MAX_ZOOM = 10;
const AIRCRAFT_ICON_SIZE = 48;
const AIRCRAFT_ICON_NAMES: Record<AircraftVisualCategory, string> = {
  generic: "aircraft-generic",
  light: "aircraft-light",
  transport: "aircraft-transport",
  fast: "aircraft-fast",
  rotor: "aircraft-rotor",
  glider: "aircraft-glider"
};

type AircraftIconImage =
  | ImageData
  | {
      width: number;
      height: number;
      data: Uint8ClampedArray;
    };

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

let trafficPopup: Popup | null = null;

/** Add GeoJSON sources and layers for live traffic to the map. */
export function addTrafficLayers(map: Map): void {
  map.addSource(AIRCRAFT_SOURCE, {
    type: "geojson",
    data: EMPTY_FC,
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM
  });

  map.addSource(SHIPS_SOURCE, {
    type: "geojson",
    data: EMPTY_FC,
    cluster: true,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM
  });

  ensureAircraftIcons(map);

  map.addLayer({
    id: AIRCRAFT_CLUSTER_LAYER,
    type: "circle",
    source: AIRCRAFT_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#67d0ff",
      "circle-opacity": 0.75,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24]
    }
  });

  map.addLayer({
    id: AIRCRAFT_CLUSTER_COUNT,
    type: "symbol",
    source: AIRCRAFT_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 11
    },
    paint: {
      "text-color": "#ffffff"
    }
  });

  map.addLayer({
    id: AIRCRAFT_LAYER,
    type: "symbol",
    source: AIRCRAFT_SOURCE,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": aircraftIconExpression(),
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.42, 8, 0.48, 12, 0.58],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotate": ["coalesce", ["get", "heading"], 0],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-keep-upright": false
    },
    paint: {
      "icon-opacity": ["coalesce", ["get", "opacity"], 1]
    }
  });

  map.addLayer({
    id: SHIPS_CLUSTER_LAYER,
    type: "circle",
    source: SHIPS_SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#f4c989",
      "circle-opacity": 0.75,
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24]
    }
  });

  map.addLayer({
    id: SHIPS_CLUSTER_COUNT,
    type: "symbol",
    source: SHIPS_SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 11
    },
    paint: {
      "text-color": "#ffffff"
    }
  });

  map.addLayer({
    id: SHIPS_LAYER,
    type: "symbol",
    source: SHIPS_SOURCE,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": ">",
      "text-font": ["Noto Sans Regular"],
      "text-size": 15,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-rotate": ["coalesce", ["get", "heading"], 0]
    },
    paint: {
      "text-color": "#f4c989",
      "text-halo-color": "#ffffff",
      "text-halo-width": 0.8,
      "text-opacity": ["coalesce", ["get", "opacity"], 1]
    }
  });

  wireTrafficPopups(map);
}

/** Update GeoJSON data for both traffic sources. */
export function updateTrafficData(map: Map, snapshot: SnapshotMessage): void {
  const now = Date.now();

  const aircraftSource = map.getSource(AIRCRAFT_SOURCE);
  if (aircraftSource && "setData" in aircraftSource) {
    (aircraftSource as { setData(data: GeoJSON.FeatureCollection): void }).setData(
      tracksToGeoJSON(snapshot.aircraft, now)
    );
  }

  const shipsSource = map.getSource(SHIPS_SOURCE);
  if (shipsSource && "setData" in shipsSource) {
    (shipsSource as { setData(data: GeoJSON.FeatureCollection): void }).setData(
      tracksToGeoJSON(snapshot.ships, now)
    );
  }
}

/** Clear only the aircraft source. */
export function clearAircraftData(map: Map): void {
  const source = map.getSource(AIRCRAFT_SOURCE);
  if (source && "setData" in source) {
    (source as { setData(data: GeoJSON.FeatureCollection): void }).setData(EMPTY_FC);
  }
}

/** Clear only the ships source. */
export function clearShipsData(map: Map): void {
  const source = map.getSource(SHIPS_SOURCE);
  if (source && "setData" in source) {
    (source as { setData(data: GeoJSON.FeatureCollection): void }).setData(EMPTY_FC);
  }
}

/** Clear both traffic sources to empty. */
export function clearTrafficData(map: Map): void {
  clearAircraftData(map);
  clearShipsData(map);
  trafficPopup?.remove();
  trafficPopup = null;
}

function wireTrafficPopups(map: Map): void {
  const interactiveLayers = [AIRCRAFT_LAYER, SHIPS_LAYER];

  for (const layerId of interactiveLayers) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  map.on("click", AIRCRAFT_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") {
      return;
    }

    showTrafficPopup(map, feature.geometry.coordinates as [number, number], feature.properties as LiveTrack);
  });

  map.on("click", SHIPS_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") {
      return;
    }

    showTrafficPopup(map, feature.geometry.coordinates as [number, number], feature.properties as LiveTrack);
  });
}

function showTrafficPopup(map: Map, coords: [number, number], props: Record<string, unknown>): void {
  trafficPopup?.remove();

  const kind = props.kind === "ship" ? "ship" : "aircraft";
  const updatedAt = typeof props.updatedAt === "number" ? props.updatedAt : 0;
  const age = formatAge(updatedAt, Date.now());
  const html = kind === "aircraft" ? buildAircraftPopupHtml(props, age) : buildShipPopupHtml(props, age);

  trafficPopup = new Popup({ closeButton: false, maxWidth: "280px", offset: 18 })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
}

function buildAircraftPopupHtml(props: Record<string, unknown>, age: string): string {
  const identity = buildAircraftPopupIdentity({
    id: readString(props.id) ?? "Unknown aircraft",
    label: readString(props.label),
    callsign: readString(props.callsign),
    flightCode: readString(props.flightCode),
    registration: readString(props.registration),
    aircraftTypeCode: readString(props.aircraftTypeCode),
    manufacturer: readString(props.manufacturer),
    model: readString(props.model),
    aircraftCategory: readNumber(props.aircraftCategory)
  });
  const speed = formatSpeed(readNumber(props.speedKnots));
  const altitude = formatAircraftAltitude({
    altitudeMeters: readNumber(props.altitudeMeters),
    geoAltitudeMeters: readNumber(props.geoAltitudeMeters)
  });

  return buildPopupHtml("Aircraft", identity.title, identity.rows, compactText(speed, altitude, age));
}

function buildShipPopupHtml(props: Record<string, unknown>, age: string): string {
  const title = readString(props.label) ?? readString(props.id) ?? "Unknown ship";
  const speed = formatSpeed(readNumber(props.speedKnots));
  const source = formatSourceLabel(readString(props.source));
  return buildPopupHtml("Ship", title, [], compactText(speed, source, age));
}

function buildPopupHtml(kindLabel: string, title: string, rows: string[], details: string | null): string {
  const rowHtml = rows
    .map((row) => `<span class="popup-identity">${escapeHtml(row)}</span>`)
    .join("");

  return `
    <div class="popup-card">
      <span class="popup-kicker">${escapeHtml(kindLabel)}</span>
      <strong>${escapeHtml(title)}</strong>
      ${rowHtml}
      ${details ? `<span class="popup-meta">${escapeHtml(details)}</span>` : ""}
    </div>
  `;
}

function ensureAircraftIcons(map: Map): void {
  for (const [category, imageName] of Object.entries(AIRCRAFT_ICON_NAMES) as Array<
    [AircraftVisualCategory, string]
  >) {
    if (map.hasImage(imageName)) {
      continue;
    }

    map.addImage(imageName, createAircraftIcon(category), { pixelRatio: 2 });
  }
}

function createAircraftIcon(category: AircraftVisualCategory): AircraftIconImage {
  const canvas = document.createElement("canvas");
  canvas.width = AIRCRAFT_ICON_SIZE;
  canvas.height = AIRCRAFT_ICON_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    return {
      width: AIRCRAFT_ICON_SIZE,
      height: AIRCRAFT_ICON_SIZE,
      data: new Uint8ClampedArray(AIRCRAFT_ICON_SIZE * AIRCRAFT_ICON_SIZE * 4)
    };
  }

  context.clearRect(0, 0, AIRCRAFT_ICON_SIZE, AIRCRAFT_ICON_SIZE);
  context.translate(AIRCRAFT_ICON_SIZE / 2, AIRCRAFT_ICON_SIZE / 2);
  context.fillStyle = "rgba(103, 208, 255, 0.96)";
  context.strokeStyle = "rgba(5, 11, 20, 0.92)";
  context.lineWidth = 2.4;
  context.lineJoin = "round";
  context.lineCap = "round";

  if (category === "rotor") {
    drawRotorIcon(context);
  } else {
    drawFixedWingIcon(context, category);
  }

  return context.getImageData(0, 0, AIRCRAFT_ICON_SIZE, AIRCRAFT_ICON_SIZE);
}

function drawFixedWingIcon(
  context: CanvasRenderingContext2D,
  category: Exclude<AircraftVisualCategory, "rotor">
): void {
  const shapes: Record<Exclude<AircraftVisualCategory, "rotor">, Array<[number, number]>> = {
    generic: [
      [0, -20],
      [4, -13],
      [4, -4],
      [17, 0],
      [17, 5],
      [4, 4],
      [4, 15],
      [10, 19],
      [10, 22],
      [0, 19],
      [-10, 22],
      [-10, 19],
      [-4, 15],
      [-4, 4],
      [-17, 5],
      [-17, 0],
      [-4, -4],
      [-4, -13]
    ],
    light: [
      [0, -20],
      [3, -14],
      [3, -4],
      [14, -6],
      [16, -2],
      [3, -1],
      [3, 14],
      [8, 18],
      [8, 21],
      [0, 18],
      [-8, 21],
      [-8, 18],
      [-3, 14],
      [-3, -1],
      [-16, -2],
      [-14, -6],
      [-3, -4],
      [-3, -14]
    ],
    transport: [
      [0, -21],
      [4, -13],
      [4, -2],
      [20, 1],
      [20, 6],
      [4, 4],
      [4, 15],
      [11, 19],
      [11, 23],
      [0, 20],
      [-11, 23],
      [-11, 19],
      [-4, 15],
      [-4, 4],
      [-20, 6],
      [-20, 1],
      [-4, -2],
      [-4, -13]
    ],
    fast: [
      [0, -21],
      [5, -12],
      [3, -4],
      [16, 3],
      [14, 8],
      [4, 4],
      [2, 16],
      [7, 22],
      [0, 20],
      [-7, 22],
      [-2, 16],
      [-4, 4],
      [-14, 8],
      [-16, 3],
      [-3, -4],
      [-5, -12]
    ],
    glider: [
      [0, -19],
      [2, -13],
      [2, -2],
      [22, -5],
      [22, -1],
      [2, 0],
      [2, 14],
      [6, 18],
      [6, 21],
      [0, 18],
      [-6, 21],
      [-6, 18],
      [-2, 14],
      [-2, 0],
      [-22, -1],
      [-22, -5],
      [-2, -2],
      [-2, -13]
    ]
  };

  drawClosedShape(context, shapes[category]);
}

function drawRotorIcon(context: CanvasRenderingContext2D): void {
  drawClosedShape(context, [
    [0, -13],
    [5, -8],
    [5, 6],
    [2, 10],
    [2, 18],
    [0, 20],
    [-2, 18],
    [-2, 10],
    [-5, 6],
    [-5, -8]
  ]);

  context.beginPath();
  context.moveTo(-18, -8);
  context.lineTo(18, -8);
  context.moveTo(0, -18);
  context.lineTo(0, 4);
  context.moveTo(-6, 18);
  context.lineTo(6, 18);
  context.stroke();
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

function aircraftIconExpression(): [
  "match",
  ["get", "aircraftVisualCategory"],
  "light",
  string,
  "transport",
  string,
  "fast",
  string,
  "rotor",
  string,
  "glider",
  string,
  string
] {
  return [
    "match",
    ["get", "aircraftVisualCategory"],
    "light",
    AIRCRAFT_ICON_NAMES.light,
    "transport",
    AIRCRAFT_ICON_NAMES.transport,
    "fast",
    AIRCRAFT_ICON_NAMES.fast,
    "rotor",
    AIRCRAFT_ICON_NAMES.rotor,
    "glider",
    AIRCRAFT_ICON_NAMES.glider,
    AIRCRAFT_ICON_NAMES.generic
  ];
}

function compactText(...parts: Array<string | null>): string | null {
  const values = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  return values.length > 0 ? values.join(" | ") : null;
}

function formatSourceLabel(source: string | null): string | null {
  if (source === "opensky") {
    return "OpenSky";
  }

  if (source === "aisstream") {
    return "AISStream";
  }

  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
