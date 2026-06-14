import type { Map, CircleLayerSpecification, LineLayerSpecification } from "maplibre-gl";

import { isObject } from "../guards";
import { createPollingOverlay } from "./createPollingOverlay";
import {
  findFirstLabelLayerId,
  findFirstRoadLayerId,
  findFirstNonBaseContentLayerId,
  type OverlayAnchorLayer
} from "./overlayAnchors";

export const ISS_API_URL = "https://api.wheretheiss.at/v1/satellites/25544";
export const ISS_POLL_INTERVAL_MS = 5_000;
export const ISS_TRAIL_MAX_POINTS = 60;
export const ISS_SOURCE_ID = "iss-position";
export const ISS_TRAIL_SOURCE_ID = "iss-trail";
export const ISS_ICON_LAYER_ID = "iss-icon";
export const ISS_TRAIL_LAYER_ID = "iss-trail-line";
export const ISS_UNAVAILABLE_NOTE = "ISS data unavailable";

export type IssPosition = {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  timestamp: number;
};

export type IssPresentation = {
  note: string | null;
};

type IssResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type IssFetch = (
  input: string,
  init?: RequestInit
) => Promise<IssResponse>;

type GeoJsonSourceLike = {
  setData(data: GeoJSON.GeoJSON): void;
};

type IssTrackerOptions = {
  fetchImpl?: IssFetch;
  pollIntervalMs?: number;
  onStateChange?: (presentation: IssPresentation) => void;
};

const INACTIVE_PRESENTATION: IssPresentation = { note: null };
const UNAVAILABLE_PRESENTATION: IssPresentation = { note: ISS_UNAVAILABLE_NOTE };

/** Parse the Where The ISS At API response into a typed position, or null on bad data. */
export function parseIssResponse(data: unknown): IssPosition | null {
  if (!isObject(data)) return null;

  const d = data as Record<string, unknown>;
  const latitude = typeof d.latitude === "number" && Number.isFinite(d.latitude) ? d.latitude : null;
  const longitude = typeof d.longitude === "number" && Number.isFinite(d.longitude) ? d.longitude : null;
  const altitude = typeof d.altitude === "number" && Number.isFinite(d.altitude) ? d.altitude : null;
  const velocity = typeof d.velocity === "number" && Number.isFinite(d.velocity) ? d.velocity : null;
  const timestamp = typeof d.timestamp === "number" && Number.isFinite(d.timestamp) ? d.timestamp : null;

  if (latitude === null || longitude === null || altitude === null || velocity === null || timestamp === null) {
    return null;
  }

  return { latitude, longitude, altitude, velocity, timestamp };
}

/** Build a GeoJSON Point feature for the ISS icon. */
export function buildIssFeature(position: IssPosition): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [position.longitude, position.latitude]
    },
    properties: {
      altitude: position.altitude,
      velocity: position.velocity,
      timestamp: position.timestamp
    }
  };
}

/**
 * Build a GeoJSON MultiLineString from trail positions.
 * Splits at the antimeridian when consecutive longitudes differ by more than 180 degrees.
 */
export function buildIssTrailFeature(trail: IssPosition[]): GeoJSON.Feature<GeoJSON.MultiLineString> {
  if (trail.length < 2) {
    return {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [] },
      properties: {}
    };
  }

  const segments: [number, number][][] = [];
  let current: [number, number][] = [[trail[0].longitude, trail[0].latitude]];

  for (let i = 1; i < trail.length; i++) {
    const prevLng = trail[i - 1].longitude;
    const prevLat = trail[i - 1].latitude;
    const curLng = trail[i].longitude;
    const curLat = trail[i].latitude;
    const delta = curLng - prevLng;

    if (Math.abs(delta) > 180) {
      // Antimeridian crossing: bridge each side to ±180 so the rendered trail
      // meets the dateline cleanly, and never drop a real vertex.
      const prevBoundary = prevLng > 0 ? 180 : -180;
      const curBoundary = -prevBoundary;
      const wrapped = delta - Math.sign(delta) * 360;
      const t = wrapped === 0 ? 0 : (prevBoundary - prevLng) / wrapped;
      const boundaryLat = prevLat + (curLat - prevLat) * t;

      current.push([prevBoundary, boundaryLat]);
      segments.push(current);
      current = [[curBoundary, boundaryLat], [curLng, curLat]];
    } else {
      current.push([curLng, curLat]);
    }
  }

  if (current.length >= 2) {
    segments.push(current);
  }

  return {
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: segments },
    properties: {}
  };
}

/** Format ISS status line with altitude and velocity. */
export function formatIssStatus(position: IssPosition): string {
  const alt = Math.round(position.altitude);
  const vel = Math.round(position.velocity);
  return `ISS: ${alt} km altitude, ${vel.toLocaleString()} km/h`;
}

export function createIssTrackerOverlay(options: IssTrackerOptions = {}) {
  const fetchImpl = options.fetchImpl ?? (fetch as IssFetch);
  const pollIntervalMs = options.pollIntervalMs ?? ISS_POLL_INTERVAL_MS;
  const onStateChange = options.onStateChange ?? (() => undefined);
  const trail: IssPosition[] = [];

  const removeOverlay = (map: Map) => {
    if (map.getLayer(ISS_ICON_LAYER_ID)) {
      map.removeLayer(ISS_ICON_LAYER_ID);
    }
    if (map.getLayer(ISS_TRAIL_LAYER_ID)) {
      map.removeLayer(ISS_TRAIL_LAYER_ID);
    }
    if (map.getSource(ISS_SOURCE_ID)) {
      map.removeSource(ISS_SOURCE_ID);
    }
    if (map.getSource(ISS_TRAIL_SOURCE_ID)) {
      map.removeSource(ISS_TRAIL_SOURCE_ID);
    }
  };

  const syncSourcesAndLayers = (map: Map, position: IssPosition) => {
    // Append to trail ring buffer. Runs only after the factory's
    // isCurrentRefresh gate has passed, preserving the original ordering where
    // the trail grew solely on current, successful refreshes.
    trail.push(position);
    if (trail.length > ISS_TRAIL_MAX_POINTS) {
      trail.splice(0, trail.length - ISS_TRAIL_MAX_POINTS);
    }

    const pointFC: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [buildIssFeature(position)]
    };
    const trailFeature = buildIssTrailFeature(trail);
    const trailFC: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [trailFeature]
    };

    const existingPositionSource = map.getSource(ISS_SOURCE_ID);
    const existingTrailSource = map.getSource(ISS_TRAIL_SOURCE_ID);

    if (existingPositionSource && hasSetData(existingPositionSource)) {
      existingPositionSource.setData(pointFC);
    } else {
      if (existingPositionSource || map.getLayer(ISS_ICON_LAYER_ID)) {
        removeOverlay(map);
      }
      map.addSource(ISS_SOURCE_ID, { type: "geojson", data: pointFC });
    }

    if (existingTrailSource && hasSetData(existingTrailSource)) {
      existingTrailSource.setData(trailFC);
    } else {
      if (existingTrailSource || map.getLayer(ISS_TRAIL_LAYER_ID)) {
        // Only remove trail-specific items, not the position source
        if (map.getLayer(ISS_TRAIL_LAYER_ID)) map.removeLayer(ISS_TRAIL_LAYER_ID);
        if (map.getSource(ISS_TRAIL_SOURCE_ID)) map.removeSource(ISS_TRAIL_SOURCE_ID);
      }
      map.addSource(ISS_TRAIL_SOURCE_ID, { type: "geojson", data: trailFC });
    }

    if (!map.getLayer(ISS_TRAIL_LAYER_ID)) {
      const layers = (map.getStyle().layers ?? []) as OverlayAnchorLayer[];
      const beforeId =
        findFirstLabelLayerId(layers) ??
        findFirstRoadLayerId(layers) ??
        findFirstNonBaseContentLayerId(layers);
      map.addLayer(createIssTrailLayer(), beforeId);
    }

    if (!map.getLayer(ISS_ICON_LAYER_ID)) {
      const layers = (map.getStyle().layers ?? []) as OverlayAnchorLayer[];
      const beforeId =
        findFirstLabelLayerId(layers) ??
        findFirstRoadLayerId(layers) ??
        findFirstNonBaseContentLayerId(layers);
      map.addLayer(createIssIconLayer(), beforeId);
    }
  };

  return createPollingOverlay<IssPosition, IssPresentation>({
    url: ISS_API_URL,
    fetchImpl,
    refreshIntervalMs: pollIntervalMs,
    requestErrorMessage: (status) => `ISS API request failed with ${status}.`,
    parse: (raw) => parseIssResponse(raw),
    syncSourceAndLayer: ({ map, parsed }) => syncSourcesAndLayers(map, parsed),
    removeOverlay,
    onBeforeEnable: () => {
      trail.length = 0;
    },
    onDisable: () => {
      trail.length = 0;
    },
    presentation: {
      inactive: INACTIVE_PRESENTATION,
      unavailable: UNAVAILABLE_PRESENTATION,
      active: (position) => ({ note: formatIssStatus(position) }),
      equals: (a, b) => a.note === b.note,
      onStateChange
    }
  });
}

function createIssIconLayer(): CircleLayerSpecification {
  return {
    id: ISS_ICON_LAYER_ID,
    type: "circle",
    source: ISS_SOURCE_ID,
    maxzoom: 5,
    paint: {
      "circle-radius": 6,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#67d0ff",
      "circle-stroke-width": 2,
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 3, 1, 5, 0],
    }
  } as CircleLayerSpecification;
}

function createIssTrailLayer(): LineLayerSpecification {
  return {
    id: ISS_TRAIL_LAYER_ID,
    type: "line",
    source: ISS_TRAIL_SOURCE_ID,
    maxzoom: 5,
    paint: {
      "line-color": "#67d0ff",
      "line-width": 1.5,
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 5, 0],
    }
  } as LineLayerSpecification;
}

function hasSetData(source: unknown): source is GeoJsonSourceLike {
  return typeof source === "object" && source !== null && "setData" in source;
}

