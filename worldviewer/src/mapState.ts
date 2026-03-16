import type { ProjectionMode } from "./projectionBehavior";

export type MapState = {
  terrainEnabled: boolean;
  buildingsEnabled: boolean;
  reliefEnabled: boolean;
  nightEnabled: boolean;
  weatherEnabled: boolean;
  measureEnabled: boolean;
  autoSpinEnabled: boolean;
  userInteracting: boolean;
  stressModeActive: boolean;
  terrainExaggeration: number;
  projectionMode: ProjectionMode;
};
