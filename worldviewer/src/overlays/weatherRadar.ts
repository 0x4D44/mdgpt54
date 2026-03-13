import type { Map, RasterLayerSpecification } from "maplibre-gl";

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
  let currentMap: Map | null = null;
  let loadHandler: (() => void) | null = null;
  let loadHandlerMap: Map | null = null;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let activeRequest: AbortController | null = null;
  let currentTileUrl: string | null = null;
  let enabled = false;
  let revision = 0;
  let refreshRevision = 0;
  let presentation = INACTIVE_PRESENTATION;

  const publish = (nextPresentation: WeatherRadarPresentation) => {
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

  const removeOverlay = (map: Map) => {
    currentTileUrl = null;

    if (map.getLayer(WEATHER_RADAR_LAYER_ID)) {
      map.removeLayer(WEATHER_RADAR_LAYER_ID);
    }
    if (map.getSource(WEATHER_RADAR_SOURCE_ID)) {
      map.removeSource(WEATHER_RADAR_SOURCE_ID);
    }
  };

  const isCurrent = (map: Map, token: number) =>
    enabled && currentMap === map && revision === token;

  const isCurrentRefresh = (map: Map, token: number, refreshToken: number) =>
    isCurrent(map, token) && refreshRevision === refreshToken;

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

  const refresh = async (map: Map, token: number) => {
    const refreshToken = ++refreshRevision;
    abortFetch();
    const controller = new AbortController();
    activeRequest = controller;

    try {
      const response = await fetchImpl(WEATHER_RADAR_METADATA_URL, {
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`RainViewer metadata request failed with ${response.status}.`);
      }

      const frame = parseLatestWeatherRadarFrame(await response.json());
      if (!isCurrentRefresh(map, token, refreshToken)) {
        return;
      }

      if (!frame) {
        removeOverlay(map);
        publish(UNAVAILABLE_PRESENTATION);
        return;
      }

      syncSourceAndLayer(map, buildWeatherRadarTileUrl(frame.host, frame.path));
      publish({
        note: formatWeatherRadarStatus(frame.time),
        creditLabel: WEATHER_RADAR_CREDIT_LABEL
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
    const reassertCurrentMap = enabled && currentMap === map && needsReassertion(map);

    if (enabled && currentMap === map && !reassertCurrentMap) {
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
    if (!reassertCurrentMap) {
      publish(INACTIVE_PRESENTATION);
    }

    const apply = () => {
      if (!isCurrent(map, token)) {
        return;
      }

      clearLoadHandler();
      if (currentTileUrl && needsReassertion(map)) {
        syncSourceAndLayer(map, currentTileUrl);
      }
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
