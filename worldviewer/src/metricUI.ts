import type { Map } from "maplibre-gl";
import { normalizeTerrainElevation } from "./reliefProfile";

export type MetricElements = {
  metricMode: HTMLElement;
  metricZoom: HTMLElement;
  metricAltitude: HTMLElement;
  metricPitch: HTMLElement;
  metricTerrain: HTMLElement;
};

export function syncMetrics(map: Map, elements: MetricElements, terrainEnabled: boolean): void {
  const zoom = map.getZoom();
  const pitch = map.getPitch();
  const altitude = calculateApproxAltitude(zoom, map.getCenter().lat, window.innerHeight);
  const terrainHeight = getTerrainHeight(map, terrainEnabled);

  elements.metricZoom.textContent = zoom.toFixed(2);
  elements.metricPitch.textContent = `${pitch.toFixed(0)}\u00B0`;
  elements.metricAltitude.textContent = formatDistance(altitude);
  elements.metricTerrain.textContent = formatElevation(terrainHeight, terrainEnabled);
  elements.metricMode.textContent = classifyView(zoom);
}

export function calculateApproxAltitude(zoom: number, latitudeDeg: number, viewportHeight: number): number {
  const latitude = latitudeDeg * (Math.PI / 180);
  const metersPerPixel = (156543.03392 * Math.cos(latitude)) / Math.pow(2, zoom);
  return metersPerPixel * (viewportHeight / 2);
}

export function getTerrainHeight(map: Map, terrainEnabled: boolean): number | null {
  if (!terrainEnabled) {
    return null;
  }

  const exaggeratedHeight = map.queryTerrainElevation(map.getCenter());
  if (exaggeratedHeight === null) {
    return null;
  }

  const exaggeration = map.getTerrain()?.exaggeration ?? 1;
  return normalizeTerrainElevation(exaggeratedHeight, exaggeration);
}

export function classifyView(zoom: number): string {
  if (zoom < 3) {
    return "Orbit";
  }

  if (zoom < 7) {
    return "Continental";
  }

  if (zoom < 11) {
    return "Regional";
  }

  if (zoom < 14) {
    return "Metro";
  }

  return "Street";
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }

  return `${Math.round(meters)} m`;
}

export function formatElevation(meters: number | null, terrainEnabled: boolean): string {
  if (!terrainEnabled) {
    return "Off";
  }

  if (meters === null) {
    return "--";
  }

  return `${Math.round(meters)} m`;
}
