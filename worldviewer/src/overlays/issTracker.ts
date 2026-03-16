import type { Map, CircleLayerSpecification, LineLayerSpecification } from "maplibre-gl";

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
    const curLng = trail[i].longitude;

    if (Math.abs(curLng - prevLng) > 180) {
      // Antimeridian crossing: finish current segment, start a new one
      if (current.length >= 2) {
        segments.push(current);
      }
      current = [[curLng, trail[i].latitude]];
    } else {
      current.push([curLng, trail[i].latitude]);
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
  let currentMap: Map | null = null;
  let loadHandler: (() => void) | null = null;
  let loadHandlerMap: Map | null = null;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let activeRequest: AbortController | null = null;
  let enabled = false;
  let revision = 0;
  let refreshRevision = 0;
  let presentation = INACTIVE_PRESENTATION;
  const trail: IssPosition[] = [];

  const publish = (nextPresentation: IssPresentation) => {
    if (presentation.note === nextPresentation.note) {
      return;
    }
    presentation = nextPresentation;
    onStateChange(nextPresentation);
  };

  const clearLoadHandler = () => {
    if (loadHandler && loadHandlerMap) {
      loadHandlerMap.off("load", loadHandler);
    }
    loadHandler = null;
    loadHandlerMap = null;
  };

  const clearTimer = () => {
    if (timer !== null) {
      globalThis.clearInterval(timer);
      timer = null;
    }
  };

  const abortFetch = () => {
    activeRequest?.abort();
    activeRequest = null;
  };

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

  const isCurrent = (map: Map, token: number) =>
    enabled && currentMap === map && revision === token;

  const isCurrentRefresh = (map: Map, token: number, refreshToken: number) =>
    isCurrent(map, token) && refreshRevision === refreshToken;

  const syncSourcesAndLayers = (map: Map, position: IssPosition) => {
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

  const refresh = async (map: Map, token: number) => {
    const refreshToken = ++refreshRevision;
    abortFetch();
    const controller = new AbortController();
    activeRequest = controller;

    try {
      const response = await fetchImpl(ISS_API_URL, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`ISS API request failed with ${response.status}.`);
      }

      const raw = await response.json();
      if (!isCurrentRefresh(map, token, refreshToken)) {
        return;
      }

      const position = parseIssResponse(raw);
      if (!position) {
        removeOverlay(map);
        publish(UNAVAILABLE_PRESENTATION);
        return;
      }

      // Append to trail ring buffer
      trail.push(position);
      if (trail.length > ISS_TRAIL_MAX_POINTS) {
        trail.splice(0, trail.length - ISS_TRAIL_MAX_POINTS);
      }

      syncSourcesAndLayers(map, position);
      publish({ note: formatIssStatus(position) });
    } catch (error) {
      if (isAbortError(error) || !isCurrentRefresh(map, token, refreshToken)) {
        return;
      }

      removeOverlay(map);
      publish(UNAVAILABLE_PRESENTATION);
    } finally {
      if (activeRequest === controller) {
        activeRequest = null;
      }
    }
  };

  const startTimer = (map: Map, token: number) => {
    clearTimer();
    timer = globalThis.setInterval(() => {
      if (!isCurrent(map, token)) {
        return;
      }
      void refresh(map, token);
    }, pollIntervalMs);
  };

  const enable = (map: Map) => {
    if (enabled && currentMap === map) {
      return;
    }

    if (enabled && currentMap && currentMap !== map) {
      removeOverlay(currentMap);
    }

    enabled = true;
    currentMap = map;
    revision += 1;
    const token = revision;
    clearLoadHandler();
    clearTimer();
    abortFetch();
    trail.length = 0;
    publish(INACTIVE_PRESENTATION);

    const apply = () => {
      if (!isCurrent(map, token)) {
        return;
      }

      clearLoadHandler();
      startTimer(map, token);
      void refresh(map, token);
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    loadHandler = () => {
      apply();
    };
    loadHandlerMap = map;
    map.on("load", loadHandler);
  };

  const disable = (map: Map) => {
    revision += 1;
    enabled = false;
    clearTimer();
    clearLoadHandler();
    abortFetch();
    trail.length = 0;
    publish(INACTIVE_PRESENTATION);

    const mapToClear = currentMap ?? map;
    removeOverlay(mapToClear);
    currentMap = null;
  };

  return { enable, disable };
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
