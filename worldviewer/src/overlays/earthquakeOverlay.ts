import type { Map, CircleLayerSpecification } from "maplibre-gl";
import { Popup } from "maplibre-gl";
import { escapeHtml } from "../escapeHtml";

import {
  findFirstLabelLayerId,
  findFirstNonBaseContentLayerId,
  findFirstRoadLayerId,
  type OverlayAnchorLayer
} from "./overlayAnchors";

export const EARTHQUAKE_API_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
export const EARTHQUAKE_REFRESH_INTERVAL_MS = 300_000;
export const EARTHQUAKE_SOURCE_ID = "earthquakes";
export const EARTHQUAKE_LAYER_ID = "earthquake-circles";
export const EARTHQUAKE_UNAVAILABLE_NOTE = "Earthquake data unavailable";
export const EARTHQUAKE_CREDIT_LABEL = "USGS";

export type EarthquakePresentation = {
  note: string | null;
  creditLabel: string | null;
};

type EarthquakeResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type EarthquakeFetch = (
  input: string,
  init?: RequestInit
) => Promise<EarthquakeResponse>;

type GeoJsonSourceLike = {
  setData(data: GeoJSON.GeoJSON): void;
};

type EarthquakeOverlayOptions = {
  fetchImpl?: EarthquakeFetch;
  updateIntervalMs?: number;
  onStateChange?: (presentation: EarthquakePresentation) => void;
};

const INACTIVE_PRESENTATION: EarthquakePresentation = {
  note: null,
  creditLabel: null
};

const UNAVAILABLE_PRESENTATION: EarthquakePresentation = {
  note: EARTHQUAKE_UNAVAILABLE_NOTE,
  creditLabel: null
};

export type EarthquakeProperties = {
  mag: number;
  place: string;
  time: number;
  depth: number;
};

/**
 * Normalize the USGS FeatureCollection by copying depth (coordinates[2])
 * into each feature's properties for easier access in popups.
 * Returns an empty FeatureCollection on malformed input.
 */
export function normalizeEarthquakeFeatures(
  fc: unknown
): GeoJSON.FeatureCollection {
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  if (!isObject(fc) || (fc as Record<string, unknown>).type !== "FeatureCollection") {
    return empty;
  }

  const candidate = fc as { features?: unknown };
  if (!Array.isArray(candidate.features)) {
    return empty;
  }

  const features: GeoJSON.Feature[] = [];
  for (const f of candidate.features) {
    if (!isObject(f)) continue;
    const feature = f as unknown as GeoJSON.Feature;
    if (!feature.geometry || feature.geometry.type !== "Point") continue;

    const coords = (feature.geometry as GeoJSON.Point).coordinates;
    const depth = Array.isArray(coords) && coords.length >= 3 ? coords[2] : 0;

    features.push({
      ...feature,
      properties: {
        ...feature.properties,
        depth: typeof depth === "number" && Number.isFinite(depth) ? depth : 0
      }
    });
  }

  return { type: "FeatureCollection", features };
}

/** Format earthquake popup HTML. */
export function formatEarthquakePopup(props: EarthquakeProperties): string {
  const mag = typeof props.mag === "number" && Number.isFinite(props.mag)
    ? props.mag.toFixed(1)
    : "?";
  const place = typeof props.place === "string" && props.place.trim().length > 0
    ? props.place.trim()
    : "Unknown location";
  const depth = typeof props.depth === "number" && Number.isFinite(props.depth)
    ? `${Math.round(props.depth)} km deep`
    : "Unknown depth";
  const time = typeof props.time === "number" && props.time > 0
    ? formatAge(props.time)
    : "Unknown time";

  return `
    <div class="popup-card">
      <span class="popup-kicker">Earthquake</span>
      <strong>M${escapeHtml(mag)} &middot; ${escapeHtml(place)}</strong>
      <span class="popup-meta">${escapeHtml(depth)} | ${escapeHtml(time)}</span>
    </div>
  `;
}

/** Format a unix-ms timestamp as a relative age string. */
export function formatAge(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format earthquake count status line. */
export function formatEarthquakeStatus(count: number): string {
  return `${count} earthquake${count === 1 ? "" : "s"} M2.5+ today - ${EARTHQUAKE_CREDIT_LABEL}`;
}

export function createEarthquakeOverlay(options: EarthquakeOverlayOptions = {}) {
  const fetchImpl = options.fetchImpl ?? (fetch as EarthquakeFetch);
  const updateIntervalMs = options.updateIntervalMs ?? EARTHQUAKE_REFRESH_INTERVAL_MS;
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
  let earthquakePopup: Popup | null = null;
  let clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  let mouseEnterHandler: (() => void) | null = null;
  let mouseLeaveHandler: (() => void) | null = null;

  const publish = (nextPresentation: EarthquakePresentation) => {
    if (
      presentation.note === nextPresentation.note &&
      presentation.creditLabel === nextPresentation.creditLabel
    ) {
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

  const clearPopup = () => {
    earthquakePopup?.remove();
    earthquakePopup = null;
  };

  const removeClickHandler = (map: Map) => {
    if (clickHandler) {
      map.off("click", EARTHQUAKE_LAYER_ID, clickHandler as never);
      clickHandler = null;
    }
    if (mouseEnterHandler) {
      map.off("mouseenter", EARTHQUAKE_LAYER_ID, mouseEnterHandler as never);
      mouseEnterHandler = null;
    }
    if (mouseLeaveHandler) {
      map.off("mouseleave", EARTHQUAKE_LAYER_ID, mouseLeaveHandler as never);
      mouseLeaveHandler = null;
    }
  };

  const removeOverlay = (map: Map) => {
    clearPopup();
    removeClickHandler(map);

    if (map.getLayer(EARTHQUAKE_LAYER_ID)) {
      map.removeLayer(EARTHQUAKE_LAYER_ID);
    }
    if (map.getSource(EARTHQUAKE_SOURCE_ID)) {
      map.removeSource(EARTHQUAKE_SOURCE_ID);
    }
  };

  const isCurrent = (map: Map, token: number) =>
    enabled && currentMap === map && revision === token;

  const isCurrentRefresh = (map: Map, token: number, refreshToken: number) =>
    isCurrent(map, token) && refreshRevision === refreshToken;

  const wirePopupHandler = (map: Map) => {
    removeClickHandler(map);

    mouseEnterHandler = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    mouseLeaveHandler = () => {
      map.getCanvas().style.cursor = "";
    };
    clickHandler = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [EARTHQUAKE_LAYER_ID]
      });
      const feature = features?.[0];
      if (!feature) return;

      const props = feature.properties as Record<string, unknown>;
      const eqProps: EarthquakeProperties = {
        mag: typeof props.mag === "number" ? props.mag : 0,
        place: typeof props.place === "string" ? props.place : "",
        time: typeof props.time === "number" ? props.time : 0,
        depth: typeof props.depth === "number" ? props.depth : 0
      };

      clearPopup();
      const coords = feature.geometry.type === "Point"
        ? (feature.geometry as GeoJSON.Point).coordinates as [number, number]
        : [e.lngLat.lng, e.lngLat.lat] as [number, number];

      earthquakePopup = new Popup({ closeButton: false, maxWidth: "280px", offset: 18 })
        .setLngLat(coords)
        .setHTML(formatEarthquakePopup(eqProps))
        .addTo(map);
    };

    map.on("mouseenter", EARTHQUAKE_LAYER_ID, mouseEnterHandler as never);
    map.on("mouseleave", EARTHQUAKE_LAYER_ID, mouseLeaveHandler as never);
    map.on("click", EARTHQUAKE_LAYER_ID, clickHandler as never);
  };

  const syncSourceAndLayer = (map: Map, fc: GeoJSON.FeatureCollection) => {
    const existingSource = map.getSource(EARTHQUAKE_SOURCE_ID);

    if (existingSource && hasSetData(existingSource)) {
      existingSource.setData(fc);
    } else {
      if (existingSource || map.getLayer(EARTHQUAKE_LAYER_ID)) {
        removeOverlay(map);
      }

      map.addSource(EARTHQUAKE_SOURCE_ID, {
        type: "geojson",
        data: fc
      });
    }

    if (!map.getLayer(EARTHQUAKE_LAYER_ID)) {
      const layers = (map.getStyle().layers ?? []) as OverlayAnchorLayer[];
      const beforeId =
        findFirstLabelLayerId(layers) ??
        findFirstRoadLayerId(layers) ??
        findFirstNonBaseContentLayerId(layers);
      map.addLayer(createEarthquakeLayer(), beforeId);
      wirePopupHandler(map);
    }
  };

  const refresh = async (map: Map, token: number) => {
    const refreshToken = ++refreshRevision;
    abortFetch();
    const controller = new AbortController();
    activeRequest = controller;

    try {
      const response = await fetchImpl(EARTHQUAKE_API_URL, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`USGS earthquake request failed with ${response.status}.`);
      }

      const raw = await response.json();
      if (!isCurrentRefresh(map, token, refreshToken)) {
        return;
      }

      const fc = normalizeEarthquakeFeatures(raw);
      if (fc.features.length === 0) {
        removeOverlay(map);
        publish(UNAVAILABLE_PRESENTATION);
        return;
      }

      syncSourceAndLayer(map, fc);
      publish({
        note: formatEarthquakeStatus(fc.features.length),
        creditLabel: EARTHQUAKE_CREDIT_LABEL
      });
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
    }, updateIntervalMs);
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
    publish(INACTIVE_PRESENTATION);

    const mapToClear = currentMap ?? map;
    removeOverlay(mapToClear);
    currentMap = null;
  };

  return {
    enable,
    disable
  };
}

function createEarthquakeLayer(): CircleLayerSpecification {
  return {
    id: EARTHQUAKE_LAYER_ID,
    type: "circle",
    source: EARTHQUAKE_SOURCE_ID,
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["get", "mag"],
        2.5, 4,
        5, 10,
        7, 20,
        9, 40
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "mag"],
        2.5, "#22c55e",
        4, "#eab308",
        5, "#f97316",
        6, "#ef4444"
      ],
      "circle-opacity": 0.8,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1
    }
  } as CircleLayerSpecification;
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

// Re-export for use by maplibre event handler type
import type * as maplibregl from "maplibre-gl";
