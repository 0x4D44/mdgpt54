import type { Map } from "maplibre-gl";
import {
  DENSE_SYMBOL_LAYER_IDS,
  shouldUsePerformanceMode
} from "./detailProfile";
import {
  resolveProjectionMode,
  shouldShowNightOverlay
} from "./projectionBehavior";
import {
  RELIEF_LAYER_IDS,
  TERRAIN_MESH_SOURCE_ID,
  getSatelliteOpacity,
  getTerrainExaggeration
} from "./reliefProfile";
import type { MapState } from "./mapState";
import type { WeatherRadarPresentation } from "./overlays/weatherRadar";
import type { EarthquakePresentation } from "./overlays/earthquakeOverlay";
import { syncMetrics, type MetricElements } from "./metricUI";

export type OverlayLike = {
  enable(map: Map): void;
  disable(map: Map): void;
};

export type SceneSyncDeps = {
  mapState: MapState;
  statusPill: HTMLDivElement;
  metricElements: MetricElements;
  solarTerminator: OverlayLike;
  weatherRadar: OverlayLike;
  earthquakeOverlay: OverlayLike;
  measureTool: OverlayLike;
  dismissPopup: () => void;
  getWeatherRadarPresentation: () => WeatherRadarPresentation;
  getEarthquakePresentation: () => EarthquakePresentation;
  getMeasureNote: () => string | null;
  sceneOverlayNote: HTMLElement;
  sceneOverlayCredit: HTMLElement;
};

const MAX_SPIN_ZOOM = 4.8;
const SLOW_SPIN_ZOOM = 2.8;
const SECONDS_PER_REVOLUTION = 170;

export function syncViewState(map: Map, deps: SceneSyncDeps): void {
  updateTerrainModel(map, deps);
  updateProjectionMode(map, deps);
  updateDetailProfile(map, deps);
  updateSatelliteOpacity(map, deps.mapState);
  syncMetrics(map, deps.metricElements, deps.mapState.terrainEnabled);
}

export function updateTerrainModel(map: Map, deps: SceneSyncDeps): void {
  const { mapState } = deps;
  if (!mapState.terrainEnabled) {
    return;
  }

  const nextExaggeration = getTerrainExaggeration(map.getZoom());
  if (Math.abs(nextExaggeration - mapState.terrainExaggeration) < 0.01) {
    return;
  }

  mapState.terrainExaggeration = nextExaggeration;
  map.setTerrain(currentTerrainOptions(map, mapState));
}

export function currentTerrainOptions(map: Map, mapState: MapState): { source: string; exaggeration: number } {
  const exaggeration = getTerrainExaggeration(map.getZoom());
  mapState.terrainExaggeration = exaggeration;
  return {
    source: TERRAIN_MESH_SOURCE_ID,
    exaggeration
  };
}

export function updateProjectionMode(map: Map, deps: SceneSyncDeps): void {
  const { mapState } = deps;
  const nextProjection = resolveProjectionMode(map.getZoom(), mapState.projectionMode);

  if (nextProjection === mapState.projectionMode) {
    return;
  }

  mapState.projectionMode = nextProjection;
  map.setProjection({ type: nextProjection });
  syncSceneOverlays(map, deps);
}

export function updateDetailProfile(map: Map, deps: SceneSyncDeps): void {
  const { mapState, statusPill, dismissPopup } = deps;
  const zoom = map.getZoom();
  const pitch = map.getPitch();
  const shouldThrottle = shouldUsePerformanceMode(zoom, pitch);

  if (shouldThrottle === mapState.stressModeActive) {
    return;
  }

  mapState.stressModeActive = shouldThrottle;

  DENSE_SYMBOL_LAYER_IDS.forEach((layerId) => {
    setLayerVisibility(map, layerId, !shouldThrottle);
  });

  if (shouldThrottle) {
    dismissPopup();
    statusPill.textContent = "Performance mode active for dense street detail.";
    return;
  }

  statusPill.textContent = "Open-data globe active.";
}

export function setReliefVisibility(map: Map, visible: boolean, mapState: MapState): void {
  RELIEF_LAYER_IDS.forEach((layerId) => {
    setLayerVisibility(map, layerId, visible);
  });

  updateSatelliteOpacity(map, mapState);
}

export function updateSatelliteOpacity(map: Map, mapState: MapState): void {
  if (!map.getLayer("satellite-imagery")) {
    return;
  }

  map.setPaintProperty(
    "satellite-imagery",
    "raster-opacity",
    getSatelliteOpacity(map.getZoom(), map.getPitch(), mapState.reliefEnabled)
  );
}

export function setLayerVisibility(map: Map, layerId: string, visible: boolean): void {
  if (!map.getLayer(layerId)) {
    return;
  }

  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

export function spinGlobe(map: Map, mapState: MapState): void {
  if (!mapState.autoSpinEnabled || mapState.userInteracting) {
    return;
  }

  const zoom = map.getZoom();
  if (zoom > MAX_SPIN_ZOOM || !map.isStyleLoaded()) {
    return;
  }

  let distancePerSecond = 360 / SECONDS_PER_REVOLUTION;
  if (zoom > SLOW_SPIN_ZOOM) {
    const zoomFactor = (MAX_SPIN_ZOOM - zoom) / (MAX_SPIN_ZOOM - SLOW_SPIN_ZOOM);
    distancePerSecond *= Math.max(zoomFactor, 0);
  }

  const center = map.getCenter();
  map.easeTo({
    center: [center.lng - distancePerSecond, center.lat],
    duration: 1000,
    easing: (value) => value
  });
}

export function syncSceneOverlays(map: Map, deps: SceneSyncDeps): void {
  const { mapState, solarTerminator, weatherRadar, earthquakeOverlay, measureTool } = deps;

  if (shouldShowNightOverlay(mapState.nightEnabled, mapState.projectionMode)) {
    solarTerminator.enable(map);
  } else {
    solarTerminator.disable(map);
  }

  if (mapState.weatherEnabled) {
    weatherRadar.enable(map);
  } else {
    weatherRadar.disable(map);
  }

  if (mapState.earthquakeEnabled) {
    earthquakeOverlay.enable(map);
  } else {
    earthquakeOverlay.disable(map);
  }

  if (mapState.measureEnabled) {
    measureTool.enable(map);
  } else {
    measureTool.disable(map);
  }

  renderSceneOverlayPresentation(deps);
}

export function renderSceneOverlayPresentation(deps: SceneSyncDeps): void {
  const {
    mapState, sceneOverlayNote, sceneOverlayCredit,
    getWeatherRadarPresentation, getEarthquakePresentation, getMeasureNote
  } = deps;
  const weatherRadarPresentation = getWeatherRadarPresentation();
  const earthquakePresentation = getEarthquakePresentation();
  const measureNote = getMeasureNote();
  const notes: string[] = [];
  const credits: string[] = [];

  if (shouldShowNightOverlay(mapState.nightEnabled, mapState.projectionMode)) {
    notes.push("Night hemisphere shows on globe and fades out by zoom 6.");
  }
  if (weatherRadarPresentation.note) {
    notes.push(weatherRadarPresentation.note);
  }
  if (earthquakePresentation.note) {
    notes.push(earthquakePresentation.note);
  }
  if (measureNote) {
    notes.push(measureNote);
  }
  if (weatherRadarPresentation.creditLabel) {
    credits.push(weatherRadarPresentation.creditLabel);
  }
  if (earthquakePresentation.creditLabel) {
    credits.push(earthquakePresentation.creditLabel);
  }

  sceneOverlayNote.hidden = notes.length === 0;
  sceneOverlayNote.textContent = notes.join(" | ");
  sceneOverlayCredit.hidden = credits.length === 0;
  sceneOverlayCredit.textContent = credits.length === 0 ? "" : `Overlays: ${credits.join(", ")}.`;
}
