export type ProjectionMode = "globe" | "mercator";

export const MERCATOR_SWITCH_ZOOM = 6;
export const GLOBE_RETURN_ZOOM = 5;

export function resolveProjectionMode(zoom: number, currentProjection: ProjectionMode): ProjectionMode {
  if (zoom >= MERCATOR_SWITCH_ZOOM) {
    return "mercator";
  }

  if (zoom <= GLOBE_RETURN_ZOOM) {
    return "globe";
  }

  return currentProjection;
}

export function shouldShowNightOverlay(nightEnabled: boolean, projectionMode: ProjectionMode): boolean {
  return nightEnabled && projectionMode === "globe";
}
