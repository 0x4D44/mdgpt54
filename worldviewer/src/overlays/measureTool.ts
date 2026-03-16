/**
 * Measurement Tool — click-to-measure geodesic distance and bearing.
 *
 * State machine: idle → first-click → complete → first-click → ...
 * Escape or disable returns to idle.
 */

import type { Map } from "maplibre-gl";

import { findFirstLabelLayerId } from "./overlayAnchors";
import {
  geodesicBearing,
  geodesicDistanceMeters,
  geodesicIntermediatePoints,
  type LngLat
} from "./measureGeodesic";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MEASURE_SOURCE_ID = "measure-tool";
export const MEASURE_LINE_LAYER_ID = "measure-line";
export const MEASURE_POINTS_LAYER_ID = "measure-points";

const DEFAULT_GEODESIC_SEGMENTS = 64;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: []
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeasureState = "idle" | "first-click" | "complete";

export type MeasureResult = {
  distanceMeters: number;
  bearingDegrees: number;
  from: LngLat;
  to: LngLat;
};

type KeydownTarget = {
  addEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
};

type MeasureToolOptions = {
  geodesicSegments?: number;
  onStateChange?: (state: MeasureState, result: MeasureResult | null) => void;
  /** Override for `document` — used in tests where no DOM is available. */
  keydownTarget?: KeydownTarget;
};

type GeoJSONSourceLike = {
  setData(data: GeoJSON.FeatureCollection): void;
};

// ---------------------------------------------------------------------------
// GeoJSON builders
// ---------------------------------------------------------------------------

function buildPointFeature(p: LngLat): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    properties: {}
  };
}

function buildLineFeature(points: LngLat[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: points.map((p) => [p.lng, p.lat])
    },
    properties: {}
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMeasureTool(options?: MeasureToolOptions) {
  const segments = options?.geodesicSegments ?? DEFAULT_GEODESIC_SEGMENTS;
  const onStateChange = options?.onStateChange;
  const keydownTarget: KeydownTarget = options?.keydownTarget ?? globalThis.document;

  let state: MeasureState = "idle";
  let pointA: LngLat | null = null;
  let active = false;
  let revision = 0;
  let savedCursor = "";

  // Listener refs for cleanup
  let clickHandler: ((e: { lngLat: { lng: number; lat: number } }) => void) | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let loadHandler: (() => void) | null = null;

  function setState(next: MeasureState, result: MeasureResult | null): void {
    state = next;
    onStateChange?.(next, result);
  }

  function updateSource(map: Map, fc: GeoJSON.FeatureCollection): void {
    const source = map.getSource(MEASURE_SOURCE_ID) as GeoJSONSourceLike | undefined;
    source?.setData(fc);
  }

  function handleClick(map: Map, lngLat: LngLat): void {
    switch (state) {
      case "idle":
      case "complete": {
        // Start a new measurement
        pointA = lngLat;
        updateSource(map, {
          type: "FeatureCollection",
          features: [buildPointFeature(lngLat)]
        });
        setState("first-click", null);
        break;
      }

      case "first-click": {
        // Complete the measurement
        const from = pointA!;
        const to = lngLat;
        const distanceMeters = geodesicDistanceMeters(from, to);
        const bearingDegrees = geodesicBearing(from, to);
        const arcPoints = geodesicIntermediatePoints(from, to, segments);

        updateSource(map, {
          type: "FeatureCollection",
          features: [
            buildLineFeature(arcPoints),
            buildPointFeature(from),
            buildPointFeature(to)
          ]
        });

        setState("complete", { distanceMeters, bearingDegrees, from, to });
        break;
      }
    }
  }

  function handleEscape(map: Map): void {
    pointA = null;
    updateSource(map, EMPTY_FC);
    setState("idle", null);
  }

  function setup(map: Map): void {
    // Guard: already set up, or disabled before load fired
    if (map.getSource(MEASURE_SOURCE_ID)) return;

    const anchorLayer = findFirstLabelLayerId(
      map.getStyle().layers as Array<{ id: string; type: string; layout?: Record<string, unknown> }>
    );

    map.addSource(MEASURE_SOURCE_ID, {
      type: "geojson",
      data: EMPTY_FC
    });

    map.addLayer(
      {
        id: MEASURE_LINE_LAYER_ID,
        type: "line",
        source: MEASURE_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#f4c989",
          "line-width": 2.5,
          "line-dasharray": [4, 3]
        }
      },
      anchorLayer
    );

    map.addLayer(
      {
        id: MEASURE_POINTS_LAYER_ID,
        type: "circle",
        source: MEASURE_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#f4c989",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5
        }
      },
      anchorLayer
    );
  }

  function enable(map: Map): void {
    if (active) return;
    active = true;
    revision++;
    const myRevision = revision;

    // Set crosshair cursor
    const canvas = (map as unknown as { getCanvas?: () => HTMLCanvasElement }).getCanvas?.();
    if (canvas) {
      savedCursor = canvas.style.cursor;
      canvas.style.cursor = "crosshair";
    }

    // Wire click handler
    clickHandler = (e: { lngLat: { lng: number; lat: number } }) => {
      if (myRevision !== revision) return;
      handleClick(map, { lng: e.lngLat.lng, lat: e.lngLat.lat });
    };
    map.on("click", clickHandler);

    // Wire Escape key
    keydownHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleEscape(map);
      }
    };
    keydownTarget.addEventListener("keydown", keydownHandler);

    // Setup layers
    if (map.isStyleLoaded()) {
      setup(map);
    } else {
      loadHandler = () => {
        if (myRevision !== revision) return;
        setup(map);
      };
      map.on("load", loadHandler);
    }
  }

  function disable(map: Map): void {
    if (!active) return;
    active = false;
    revision++;

    // Remove event listeners
    if (clickHandler) {
      map.off("click", clickHandler);
      clickHandler = null;
    }
    if (keydownHandler) {
      keydownTarget.removeEventListener("keydown", keydownHandler);
      keydownHandler = null;
    }
    if (loadHandler) {
      map.off("load", loadHandler);
      loadHandler = null;
    }

    // Restore cursor
    const canvas = (map as unknown as { getCanvas?: () => HTMLCanvasElement }).getCanvas?.();
    if (canvas) {
      canvas.style.cursor = savedCursor;
    }

    // Remove layers and source
    if (map.getLayer(MEASURE_LINE_LAYER_ID)) {
      map.removeLayer(MEASURE_LINE_LAYER_ID);
    }
    if (map.getLayer(MEASURE_POINTS_LAYER_ID)) {
      map.removeLayer(MEASURE_POINTS_LAYER_ID);
    }
    if (map.getSource(MEASURE_SOURCE_ID)) {
      map.removeSource(MEASURE_SOURCE_ID);
    }

    // Reset state
    pointA = null;
    if (state !== "idle") {
      setState("idle", null);
    }
  }

  return { enable, disable };
}
