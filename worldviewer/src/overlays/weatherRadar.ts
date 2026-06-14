import type { Map, RasterLayerSpecification } from "maplibre-gl";

import { isObject } from "../guards";
import { createPollingOverlay } from "./createPollingOverlay";
import {
  findFirstLabelLayerId,
  findFirstNonBaseContentLayerId,
  findFirstRoadLayerId,
  type OverlayAnchorLayer
} from "./overlayAnchors";

export const WEATHER_RADAR_SOURCE_ID = "weather-radar";
export const WEATHER_RADAR_LAYER_ID = "weather-radar";
export const WEATHER_RADAR_METADATA_URL = "https://api.rainviewer.com/public/weather-maps.json";
export const WEATHER_RADAR_REFRESH_INTERVAL_MS = 300_000;
export const WEATHER_RADAR_SOURCE_MAX_ZOOM = 7;
export const WEATHER_RADAR_LAYER_MAX_ZOOM = 8;
export const WEATHER_RADAR_OPACITY = 0.6;
export const WEATHER_RADAR_ATTRIBUTION =
  'Radar data <a href="https://www.rainviewer.com/">RainViewer</a>';
export const WEATHER_RADAR_COLOR_SCHEME = 2;
export const WEATHER_RADAR_TILE_OPTIONS = "1_0";
export const WEATHER_RADAR_UNAVAILABLE_NOTE = "Radar unavailable";
export const WEATHER_RADAR_CREDIT_LABEL = "RainViewer";

export type WeatherRadarFrame = {
  host: string;
  path: string;
  time: number;
};

export type WeatherRadarPresentation = {
  note: string | null;
  creditLabel: string | null;
};

type WeatherMapsMetadata = {
  host?: unknown;
  radar?: {
    past?: unknown;
  };
};

type WeatherMapsFrame = {
  path?: unknown;
  time?: unknown;
};

type WeatherRadarResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type WeatherRadarFetch = (
  input: string,
  init?: RequestInit
) => Promise<WeatherRadarResponse>;

type RasterTileSourceLike = {
  setTiles(tiles: string[]): void;
};

type WeatherRadarOverlayOptions = {
  fetchImpl?: WeatherRadarFetch;
  updateIntervalMs?: number;
  onStateChange?: (presentation: WeatherRadarPresentation) => void;
};

const INACTIVE_PRESENTATION: WeatherRadarPresentation = {
  note: null,
  creditLabel: null
};

const UNAVAILABLE_PRESENTATION: WeatherRadarPresentation = {
  note: WEATHER_RADAR_UNAVAILABLE_NOTE,
  creditLabel: null
};

export function parseLatestWeatherRadarFrame(metadata: unknown): WeatherRadarFrame | null {
  if (!isObject(metadata)) {
    return null;
  }

  const weatherMetadata = metadata as WeatherMapsMetadata;
  const host = normalizeRainViewerHost(weatherMetadata.host);
  const pastFrames = weatherMetadata.radar?.past;

  if (!host || !Array.isArray(pastFrames) || pastFrames.length === 0) {
    return null;
  }

  let latestFrame: WeatherRadarFrame | null = null;

  for (const candidate of pastFrames) {
    if (!isObject(candidate)) {
      continue;
    }

    const frame = candidate as WeatherMapsFrame;
    const path = normalizeRainViewerPath(frame.path);
    const time = typeof frame.time === "number" && Number.isFinite(frame.time) ? frame.time : null;
    if (!path || time === null) {
      continue;
    }

    if (!latestFrame || time > latestFrame.time) {
      latestFrame = {
        host,
        path,
        time
      };
    }
  }

  return latestFrame;
}

export function buildWeatherRadarTileUrl(host: string, path: string): string {
  const normalizedHost = normalizeRainViewerHost(host);
  const normalizedPath = normalizeRainViewerPath(path);

  if (!normalizedHost || !normalizedPath) {
    throw new Error("RainViewer host and path must be non-empty strings.");
  }

  return `${normalizedHost}${normalizedPath}/512/{z}/{x}/{y}/${WEATHER_RADAR_COLOR_SCHEME}/${WEATHER_RADAR_TILE_OPTIONS}.png`;
}

export function formatWeatherRadarStatus(timeSeconds: number): string {
  const frameTime = new Date(timeSeconds * 1_000);
  const hours = frameTime.getUTCHours().toString().padStart(2, "0");
  const minutes = frameTime.getUTCMinutes().toString().padStart(2, "0");
  return `Radar frame ${hours}:${minutes} UTC - ${WEATHER_RADAR_CREDIT_LABEL}`;
}

export function createWeatherRadarOverlay(options: WeatherRadarOverlayOptions = {}) {
  const fetchImpl = options.fetchImpl ?? (fetch as WeatherRadarFetch);
  const updateIntervalMs = options.updateIntervalMs ?? WEATHER_RADAR_REFRESH_INTERVAL_MS;
  const onStateChange = options.onStateChange ?? (() => undefined);
  let currentTileUrl: string | null = null;

  const removeOverlay = (map: Map) => {
    currentTileUrl = null;

    if (map.getLayer(WEATHER_RADAR_LAYER_ID)) {
      map.removeLayer(WEATHER_RADAR_LAYER_ID);
    }
    if (map.getSource(WEATHER_RADAR_SOURCE_ID)) {
      map.removeSource(WEATHER_RADAR_SOURCE_ID);
    }
  };

  const needsReassertion = (map: Map) =>
    !map.getSource(WEATHER_RADAR_SOURCE_ID) || !map.getLayer(WEATHER_RADAR_LAYER_ID);

  const syncSourceAndLayer = (map: Map, tileUrl: string) => {
    const existingSource = map.getSource(WEATHER_RADAR_SOURCE_ID);

    if (existingSource && hasSetTiles(existingSource)) {
      if (currentTileUrl !== tileUrl) {
        existingSource.setTiles([tileUrl]);
      }
    } else {
      if (existingSource || map.getLayer(WEATHER_RADAR_LAYER_ID)) {
        removeOverlay(map);
      }

      map.addSource(WEATHER_RADAR_SOURCE_ID, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 512,
        maxzoom: WEATHER_RADAR_SOURCE_MAX_ZOOM,
        attribution: WEATHER_RADAR_ATTRIBUTION
      });
    }

    if (!map.getLayer(WEATHER_RADAR_LAYER_ID)) {
      const layers = (map.getStyle().layers ?? []) as OverlayAnchorLayer[];
      const beforeId =
        findFirstRoadLayerId(layers) ??
        findFirstLabelLayerId(layers) ??
        findFirstNonBaseContentLayerId(layers);
      map.addLayer(createWeatherRadarLayer(), beforeId);
    }

    currentTileUrl = tileUrl;
  };

  return createPollingOverlay<WeatherRadarFrame, WeatherRadarPresentation>({
    url: WEATHER_RADAR_METADATA_URL,
    fetchImpl,
    refreshIntervalMs: updateIntervalMs,
    requestErrorMessage: (status) => `RainViewer metadata request failed with ${status}.`,
    parse: (raw) => parseLatestWeatherRadarFrame(raw),
    syncSourceAndLayer: ({ map, parsed }) =>
      syncSourceAndLayer(map, buildWeatherRadarTileUrl(parsed.host, parsed.path)),
    removeOverlay,
    shouldReassertOnEnable: (map) => currentTileUrl !== null && needsReassertion(map),
    reassert: (map) => {
      if (currentTileUrl && needsReassertion(map)) {
        syncSourceAndLayer(map, currentTileUrl);
      }
    },
    presentation: {
      inactive: INACTIVE_PRESENTATION,
      unavailable: UNAVAILABLE_PRESENTATION,
      active: (frame) => ({
        note: formatWeatherRadarStatus(frame.time),
        creditLabel: WEATHER_RADAR_CREDIT_LABEL
      }),
      equals: (a, b) => a.note === b.note && a.creditLabel === b.creditLabel,
      onStateChange
    }
  });
}

function createWeatherRadarLayer(): RasterLayerSpecification {
  return {
    id: WEATHER_RADAR_LAYER_ID,
    type: "raster",
    source: WEATHER_RADAR_SOURCE_ID,
    maxzoom: WEATHER_RADAR_LAYER_MAX_ZOOM,
    paint: {
      "raster-opacity": WEATHER_RADAR_OPACITY
    }
  };
}

function hasSetTiles(source: unknown): source is RasterTileSourceLike {
  return typeof source === "object" && source !== null && "setTiles" in source;
}

function normalizeRainViewerHost(host: unknown): string | null {
  if (typeof host !== "string") {
    return null;
  }

  const trimmedHost = host.trim();
  if (trimmedHost.length === 0) {
    return null;
  }

  // The host arrives from the untrusted RainViewer metadata JSON and is used
  // verbatim as a MapLibre tile origin. Constrain it to https RainViewer hosts
  // so a spoofed/MITM'd metadata response can't redirect all tile requests to
  // an attacker origin.
  let parsed: URL;
  try {
    parsed = new URL(trimmedHost);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  const hostname = parsed.hostname;
  if (hostname !== "rainviewer.com" && !hostname.endsWith(".rainviewer.com")) {
    return null;
  }

  return trimmedHost.endsWith("/") ? trimmedHost.slice(0, -1) : trimmedHost;
}

function normalizeRainViewerPath(path: unknown): string | null {
  if (typeof path !== "string") {
    return null;
  }

  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    return null;
  }

  return trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
}

