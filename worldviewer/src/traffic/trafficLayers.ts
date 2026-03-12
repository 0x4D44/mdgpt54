import { type Map, Popup } from "maplibre-gl";

import { escapeHtml } from "../escapeHtml";
import { formatAge, formatAltitude, formatSpeed, tracksToGeoJSON } from "./trafficHelpers";
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

  // Aircraft cluster circles
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

  // Aircraft cluster count labels
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

  // Individual aircraft points
  map.addLayer({
    id: AIRCRAFT_LAYER,
    type: "symbol",
    source: AIRCRAFT_SOURCE,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": "^",
      "text-font": ["Noto Sans Regular"],
      "text-size": 18,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-rotate": ["coalesce", ["get", "heading"], 0]
    },
    paint: {
      "text-color": "#67d0ff",
      "text-halo-color": "#ffffff",
      "text-halo-width": 0.8,
      "text-opacity": ["coalesce", ["get", "opacity"], 1]
    }
  });

  // Ship cluster circles
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

  // Ship cluster count labels
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

  // Individual ship points
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

  // Click handlers for popups
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

  map.on("click", AIRCRAFT_LAYER, (e) => {
    const feature = e.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    showTrafficPopup(map, feature.geometry.coordinates as [number, number], feature.properties as LiveTrack);
  });

  map.on("click", SHIPS_LAYER, (e) => {
    const feature = e.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    showTrafficPopup(map, feature.geometry.coordinates as [number, number], feature.properties as LiveTrack);
  });
}

function showTrafficPopup(map: Map, coords: [number, number], props: Record<string, unknown>): void {
  trafficPopup?.remove();

  const kind = props.kind as string;
  const label = (props.label as string) || (props.id as string);
  const speed = formatSpeed(typeof props.speedKnots === "number" ? props.speedKnots : null);
  const altitude = formatAltitude(typeof props.altitudeMeters === "number" ? props.altitudeMeters : null);
  const source = props.source as string;
  const updatedAt = typeof props.updatedAt === "number" ? props.updatedAt : 0;
  const age = formatAge(updatedAt, Date.now());

  const details: string[] = [];
  if (speed) details.push(speed);
  if (altitude) details.push(altitude);
  details.push(source === "opensky" ? "OpenSky" : "AISStream");
  details.push(age);

  const kindLabel = kind === "aircraft" ? "Aircraft" : "Ship";
  const html = `
    <div class="popup-card">
      <strong>${escapeHtml(`${kindLabel}: ${label}`)}</strong>
      <span>${escapeHtml(details.join(" · "))}</span>
    </div>
  `;

  trafficPopup = new Popup({ closeButton: false, maxWidth: "280px", offset: 18 })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map);
}

