import type { Mock } from "vitest";
import { vi } from "vitest";

type LoadListener = () => void;

type StyleLayer = { id: string; type: string; source?: string; layout?: unknown };

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MockMap {
  styleLoaded: boolean;
  readonly addSource: Mock<(id: string, source: any) => void>;
  readonly getSource: Mock<(id: string) => any>;
  readonly addLayer: Mock<(layer: { id: string }, beforeId?: string) => void>;
  readonly getLayer: Mock<(id: string) => any>;
  readonly removeLayer: Mock<(id: string) => void>;
  readonly removeSource: Mock<(id: string) => void>;
  readonly isStyleLoaded: Mock<() => boolean>;
  readonly on: Mock<(event: string, listener: LoadListener) => void>;
  readonly off: Mock<(event: string, listener: LoadListener) => void>;
  readonly getStyle: Mock<() => { layers: StyleLayer[] }>;
  emitLoad(): void;
  getLayerAnchor(id: string): string | undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const DEFAULT_STYLE_LAYERS: StyleLayer[] = [
  { id: "background", type: "background" },
  { id: "satellite-imagery", type: "raster", source: "satellite" },
  { id: "road_minor", type: "line" },
  { id: "label_city", type: "symbol", layout: { "text-field": ["get", "name"] } }
];

export function createMockMap(options?: {
  defaultStyleLayers?: StyleLayer[];
  sourceFactory?: (id: string, source: Record<string, unknown>) => Record<string, unknown>;
}): MockMap {
  const sources = new Map<string, Record<string, unknown>>();
  const layers = new Map<string, unknown>();
  const layerAnchors = new Map<string, string | undefined>();
  const loadListeners = new Set<LoadListener>();

  const styleLayers = options?.defaultStyleLayers ?? DEFAULT_STYLE_LAYERS;
  const sourceFactory = options?.sourceFactory;

  const map: MockMap = {
    styleLoaded: true,

    addSource: vi.fn((id: string, source: Record<string, unknown>) => {
      const stored = sourceFactory ? sourceFactory(id, source) : { ...source };
      sources.set(id, stored);
    }),

    getSource: vi.fn((id: string) => sources.get(id)),

    addLayer: vi.fn((layer: { id: string }, beforeId?: string) => {
      layers.set(layer.id, layer);
      layerAnchors.set(layer.id, beforeId);
    }),

    getLayer: vi.fn((id: string) => layers.get(id)),

    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
      layerAnchors.delete(id);
    }),

    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),

    isStyleLoaded: vi.fn(() => map.styleLoaded),

    on: vi.fn((event: string, listener: LoadListener) => {
      if (event === "load") {
        loadListeners.add(listener);
      }
    }),

    off: vi.fn((event: string, listener: LoadListener) => {
      if (event === "load") {
        loadListeners.delete(listener);
      }
    }),

    getStyle: vi.fn(() => ({
      layers: styleLayers
    })),

    emitLoad(): void {
      map.styleLoaded = true;
      for (const listener of [...loadListeners]) {
        listener();
      }
    },

    getLayerAnchor(id: string): string | undefined {
      return layerAnchors.get(id);
    }
  };

  return map;
}
