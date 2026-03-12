import "./style.css";
import { escapeHtml } from "./escapeHtml";
import mlcontour from "maplibre-contour";
import maplibregl, {
  type StyleSpecification,
  Map,
  NavigationControl,
  Popup,
  ScaleControl
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  DENSE_SYMBOL_LAYER_IDS,
  MAX_BROWSER_ZOOM,
  shouldUsePerformanceMode
} from "./detailProfile";
import {
  CONTOUR_THRESHOLDS,
  CONTOUR_SOURCE_ID,
  RELIEF_DEM_SOURCE_ID,
  RELIEF_LAYER_IDS,
  TERRAIN_MESH_SOURCE_ID,
  getHillshadeExaggerationExpression,
  getSatelliteOpacity,
  getTerrainExaggeration,
  normalizeTerrainElevation
} from "./reliefProfile";
import { TrafficClient } from "./traffic/trafficClient";
import {
  addTrafficLayers,
  clearAircraftData,
  clearShipsData,
  clearTrafficData,
  updateTrafficData
} from "./traffic/trafficLayers";
import {
  createTrafficUI,
  updateLayerAvailability,
  updateLayerStatusHints,
  updateTrafficCredit,
  updateTrafficStatus,
  type TrafficUIElements
} from "./traffic/trafficUI";
import type { SnapshotStatus } from "./traffic/trafficTypes";

type Preset = {
  id: string;
  label: string;
  caption: string;
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

type SearchResult = {
  label: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
};

type MapState = {
  terrainEnabled: boolean;
  buildingsEnabled: boolean;
  reliefEnabled: boolean;
  autoSpinEnabled: boolean;
  userInteracting: boolean;
  stressModeActive: boolean;
  terrainExaggeration: number;
  projectionMode: "globe" | "mercator";
};

type StyleSource = {
  type: string;
  [key: string]: unknown;
};

type StyleLayer = {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
};

type StyleSpec = {
  version: 8;
  name?: string;
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  sprite?: string;
  glyphs?: string;
  metadata?: Record<string, unknown>;
  sources: Record<string, StyleSource>;
  layers: StyleLayer[];
  projection?: { type: "globe" | "mercator" };
  terrain?: { source: string; exaggeration?: number };
  sky?: Record<string, unknown>;
  [key: string]: unknown;
};

const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const TERRAIN_TILE_TEMPLATE_URL =
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const TERRAIN_ATTRIBUTION =
  'Terrain Â© <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> / <a href="https://github.com/tilezen/joerd/blob/master/docs/formats.md#terrarium">Terrarium</a>';
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const MAX_SPIN_ZOOM = 4.8;
const SLOW_SPIN_ZOOM = 2.8;
const SECONDS_PER_REVOLUTION = 170;
const MERCATOR_SWITCH_ZOOM = 6;
const GLOBE_RETURN_ZOOM = 5;
const BUILDING_LAYER_ID = "building-3d";
const FLAT_BUILDING_LAYER_ID = "building";
const HILLSHADE_LAYER_ID = "terrain-hillshade";
const CONTOUR_LINE_LAYER_ID = "terrain-contours-line";
const CONTOUR_LABEL_LAYER_ID = "terrain-contours-label";
const LABEL_LAYER_IDS = [
  "label_other",
  "label_village",
  "label_town",
  "label_state",
  "label_city",
  "label_city_capital",
  "label_country_3",
  "label_country_2",
  "label_country_1",
  "poi_r20",
  "poi_r7",
  "poi_r1",
  "poi_transit",
  "waterway_line_label",
  "water_name_point_label",
  "water_name_line_label",
  "road_shield_us"
] as const;
const FEATURE_QUERY_LAYERS = [
  BUILDING_LAYER_ID,
  FLAT_BUILDING_LAYER_ID,
  "road_motorway",
  "road_trunk_primary",
  "road_secondary_tertiary",
  "road_minor",
  "poi_r1",
  "poi_r7",
  "poi_r20"
] as const;

const PRESETS: Preset[] = [
  {
    id: "earth",
    label: "Earthrise",
    caption: "Global orbit with a slow spin and atmosphere.",
    lng: 12,
    lat: 21,
    zoom: 1.2,
    pitch: 0,
    bearing: -10
  },
  {
    id: "nyc",
    label: "Manhattan",
    caption: "Dense buildings and block-level street context.",
    lng: -73.98565,
    lat: 40.74844,
    zoom: 16.25,
    pitch: 74,
    bearing: 15
  },
  {
    id: "tokyo",
    label: "Tokyo",
    caption: "Urban scale with terrain and dense road labels.",
    lng: 139.75914,
    lat: 35.68284,
    zoom: 15.6,
    pitch: 70,
    bearing: 36
  },
  {
    id: "rio",
    label: "Rio",
    caption: "A terrain-heavy city flyover near the coast.",
    lng: -43.1729,
    lat: -22.9068,
    zoom: 14.4,
    pitch: 78,
    bearing: 146
  }
];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found.");
}

app.innerHTML = `
  <div class="app-shell">
    <div class="space-backdrop" aria-hidden="true"></div>
    <div id="map" class="map-panel" role="application" aria-label="Interactive 3D Earth twin"></div>
    <aside class="control-dock">
      <p class="eyebrow">Orbital Browser Twin</p>
      <h1>Earth from orbit to street scale.</h1>
      <p class="lede">
        Open imagery, terrain, vector streets, and 3D buildings tuned for a normal browser.
      </p>

      <form id="search-form" class="search-form">
        <label class="sr-only" for="search-input">Search for a place or street</label>
        <div class="search-row">
          <input
            id="search-input"
            name="query"
            type="search"
            placeholder="Find a city, district, or street"
            autocomplete="off"
          />
          <button type="submit">Search</button>
        </div>
        <p id="search-message" class="search-message">Try London, Shibuya Crossing, or Copacabana.</p>
        <div id="search-results" class="search-results" aria-live="polite"></div>
      </form>

      <section class="preset-section">
        <div class="section-head">
          <h2>Launch Views</h2>
          <span>Fast camera jumps</span>
        </div>
        <div class="preset-grid">
          ${PRESETS.map(
            (preset) => `
              <button
                type="button"
                class="preset-card"
                data-preset="${preset.id}"
              >
                <strong>${preset.label}</strong>
                <span>${preset.caption}</span>
              </button>
            `
          ).join("")}
        </div>
      </section>

      <section class="toggle-section">
        <div class="section-head">
          <h2>Scene</h2>
          <span>Runtime controls</span>
        </div>
        <div class="toggle-grid">
          <button type="button" class="toggle-chip is-active" data-toggle="terrain">Terrain</button>
          <button type="button" class="toggle-chip is-active" data-toggle="relief">Relief</button>
          <button type="button" class="toggle-chip is-active" data-toggle="buildings">3D Buildings</button>
          <button type="button" class="toggle-chip is-active" data-toggle="spin">Orbit Spin</button>
        </div>
      </section>

      <section class="metric-section">
        <div class="section-head">
          <h2>Telemetry</h2>
          <span>Live view state</span>
        </div>
        <dl class="metric-grid">
          <div>
            <dt>Mode</dt>
            <dd id="metric-mode">Loading…</dd>
          </div>
          <div>
            <dt>Zoom</dt>
            <dd id="metric-zoom">--</dd>
          </div>
          <div>
            <dt>Altitude</dt>
            <dd id="metric-altitude">--</dd>
          </div>
          <div>
            <dt>Pitch</dt>
            <dd id="metric-pitch">--</dd>
          </div>
          <div>
            <dt>Terrain</dt>
            <dd id="metric-terrain">--</dd>
          </div>
        </dl>
      </section>

      <p class="credit-note">
        Layers: OpenFreeMap, EOX Maps, AWS Terrain Tiles, OpenStreetMap Nominatim.
      </p>
    </aside>

    <div id="status-pill" class="status-pill">Loading open Earth layers…</div>
  </div>
`;

const mapContainer = document.querySelector<HTMLDivElement>("#map")!;
const statusPill = document.querySelector<HTMLDivElement>("#status-pill")!;
const searchForm = document.querySelector<HTMLFormElement>("#search-form")!;
const searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
const searchMessage = document.querySelector<HTMLParagraphElement>("#search-message")!;
const searchResults = document.querySelector<HTMLDivElement>("#search-results")!;
const metricMode = document.querySelector<HTMLElement>("#metric-mode")!;
const metricZoom = document.querySelector<HTMLElement>("#metric-zoom")!;
const metricAltitude = document.querySelector<HTMLElement>("#metric-altitude")!;
const metricPitch = document.querySelector<HTMLElement>("#metric-pitch")!;
const metricTerrain = document.querySelector<HTMLElement>("#metric-terrain")!;
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-preset]"));
const toggleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-toggle]"));

const mapState: MapState = {
  terrainEnabled: true,
  buildingsEnabled: true,
  reliefEnabled: true,
  autoSpinEnabled: true,
  userInteracting: false,
  stressModeActive: false,
  terrainExaggeration: getTerrainExaggeration(1.2),
  projectionMode: "globe"
};

let map: Map | null = null;
let activePopup: Popup | null = null;

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    const demSource = new mlcontour.DemSource({
      url: TERRAIN_TILE_TEMPLATE_URL,
      encoding: "terrarium",
      maxzoom: 15,
      worker: true,
      cacheSize: 128,
      timeoutMs: 12000
    });
    demSource.setupMaplibre(maplibregl);

    const style = await buildStyle(demSource);
    map = createMap(style);
    wireMap(map);
    wireSearch();
    wirePresets();
    wireToggles();
    wireTraffic(map);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the globe.";
    statusPill.textContent = message;
    statusPill.classList.add("is-error");
  }
}

async function buildStyle(demSource: InstanceType<typeof mlcontour.DemSource>): Promise<StyleSpecification> {
  const response = await fetch(OPENFREEMAP_STYLE_URL);
  if (!response.ok) {
    throw new Error(`Style request failed with ${response.status}.`);
  }

  const baseStyle = (await response.json()) as StyleSpec;
  const sources: Record<string, StyleSource> = {
    ...baseStyle.sources,
    satellite: {
      type: "raster",
      tiles: [SATELLITE_TILE_URL],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Imagery © <a href="https://maps.eox.at/">EOX Maps</a>'
    },
    [TERRAIN_MESH_SOURCE_ID]: {
      type: "raster-dem",
      tiles: [demSource.sharedDemProtocolUrl],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
      attribution: TERRAIN_ATTRIBUTION
    },
    [RELIEF_DEM_SOURCE_ID]: {
      type: "raster-dem",
      tiles: [demSource.sharedDemProtocolUrl],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
      attribution: TERRAIN_ATTRIBUTION
    },
    [CONTOUR_SOURCE_ID]: {
      type: "vector",
      tiles: [
        demSource.contourProtocolUrl({
          thresholds: CONTOUR_THRESHOLDS,
          contourLayer: "contours",
          elevationKey: "ele",
          levelKey: "level"
        })
      ],
      maxzoom: 15,
      attribution: 'Contours via <a href="https://github.com/onthegomap/maplibre-contour">maplibre-contour</a>'
    }
  };

  const transformedLayers = baseStyle.layers.map((layer) => {
    const nextLayer: StyleLayer = {
      ...layer
    };

    if (layer.layout) {
      nextLayer.layout = { ...layer.layout };
    }

    if (layer.paint) {
      nextLayer.paint = { ...layer.paint };
    }

    if (nextLayer.id === "background") {
      nextLayer.paint = {
        ...(nextLayer.paint ?? {}),
        "background-color": "#050b14"
      };
    }

    if (nextLayer.id === "natural_earth" && nextLayer.paint) {
      nextLayer.paint["raster-opacity"] = [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        0.12,
        4,
        0.06,
        6,
        0
      ];
    }

    if (nextLayer.type === "fill" && nextLayer.id !== FLAT_BUILDING_LAYER_ID && nextLayer.paint) {
      nextLayer.paint["fill-opacity"] = selectFillOpacity(nextLayer.id);
    }

    if (nextLayer.id === BUILDING_LAYER_ID && nextLayer.paint) {
      nextLayer.paint["fill-extrusion-color"] = [
        "interpolate",
        ["linear"],
        ["get", "render_height"],
        0,
        "#d8d3cc",
        120,
        "#b9b4ae",
        300,
        "#9d9a96"
      ];
      nextLayer.paint["fill-extrusion-opacity"] = 0.86;
    }

    if (nextLayer.id === FLAT_BUILDING_LAYER_ID && nextLayer.paint) {
      nextLayer.paint["fill-opacity"] = [
        "interpolate",
        ["linear"],
        ["zoom"],
        13,
        0.18,
        14,
        0.3
      ];
      nextLayer.paint["fill-outline-color"] = "rgba(255,255,255,0.18)";
    }

    if (LABEL_LAYER_IDS.includes(nextLayer.id as (typeof LABEL_LAYER_IDS)[number]) && nextLayer.paint) {
      nextLayer.paint["text-halo-color"] = "rgba(13, 17, 24, 0.88)";
      nextLayer.paint["text-halo-width"] = 1.2;
      nextLayer.paint["text-color"] = "#f7fafc";
    }

    if (nextLayer.type === "line" && nextLayer.id.startsWith("road_") && nextLayer.paint) {
      nextLayer.paint["line-opacity"] = selectRoadOpacity(nextLayer.id);
    }

    return nextLayer;
  });

  const satelliteLayer: StyleLayer = {
    id: "satellite-imagery",
    type: "raster",
    source: "satellite",
    maxzoom: 17,
    paint: {
      "raster-saturation": -0.28,
      "raster-contrast": 0.24,
      "raster-brightness-min": 0.05,
      "raster-brightness-max": 0.88,
      "raster-opacity": getSatelliteOpacity(1.2, 0, mapState.reliefEnabled)
    }
  };

  const hillshadeLayer: StyleLayer = {
    id: HILLSHADE_LAYER_ID,
    type: "hillshade",
    source: RELIEF_DEM_SOURCE_ID,
    minzoom: 6,
    paint: {
      "hillshade-exaggeration": getHillshadeExaggerationExpression(),
      "hillshade-shadow-color": "rgba(10, 16, 24, 0.7)",
      "hillshade-highlight-color": "rgba(255, 244, 214, 0.52)",
      "hillshade-accent-color": "rgba(255, 255, 255, 0.24)",
      "hillshade-illumination-direction": 315,
      "hillshade-illumination-anchor": "viewport"
    }
  };

  const contourLineLayer: StyleLayer = {
    id: CONTOUR_LINE_LAYER_ID,
    type: "line",
    source: CONTOUR_SOURCE_ID,
    "source-layer": "contours",
    minzoom: 9.5,
    layout: {
      "line-join": "round"
    },
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "level"], 1],
        "rgba(255, 245, 210, 0.72)",
        "rgba(255, 255, 255, 0.32)"
      ],
      "line-opacity": [
        "case",
        ["==", ["get", "level"], 1],
        0.85,
        0.42
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9.5,
        0.55,
        12,
        0.9,
        14,
        1.4
      ]
    }
  };

  const contourLabelLayer: StyleLayer = {
    id: CONTOUR_LABEL_LAYER_ID,
    type: "symbol",
    source: CONTOUR_SOURCE_ID,
    "source-layer": "contours",
    minzoom: 10.8,
    filter: ["==", ["get", "level"], 1],
    layout: {
      "symbol-placement": "line",
      "text-field": ["concat", ["to-string", ["get", "ele"]], " m"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10.5
    },
    paint: {
      "text-color": "rgba(255,248,224,0.84)",
      "text-halo-color": "rgba(13, 17, 24, 0.82)",
      "text-halo-width": 1.1
    }
  };

  const layers = [
    transformedLayers[0],
    satelliteLayer,
    hillshadeLayer,
    ...transformedLayers.slice(1)
  ];

  const contourInsertIndex = layers.findIndex((layer) => layer.id === "road_area_pattern");
  if (contourInsertIndex >= 0) {
    layers.splice(contourInsertIndex, 0, contourLineLayer, contourLabelLayer);
  } else {
    layers.push(contourLineLayer, contourLabelLayer);
  }

  return {
    ...baseStyle,
    projection: { type: "globe" },
    sources,
    layers,
    terrain: {
      source: TERRAIN_MESH_SOURCE_ID,
      exaggeration: mapState.terrainExaggeration
    }
  } as unknown as StyleSpecification;
}

function createMap(style: StyleSpecification): Map {
  return new maplibregl.Map({
    container: mapContainer,
    style,
    center: [12, 22],
    zoom: 1.2,
    pitch: 0,
    bearing: -10,
    maxZoom: MAX_BROWSER_ZOOM,
    minZoom: 0.7,
    attributionControl: false,
    canvasContextAttributes: {
      antialias: true
    }
  });
}

function wireMap(mapInstance: Map): void {
  let sceneReady = false;
  let syncHandle = 0;
  const scheduleViewSync = () => {
    if (syncHandle !== 0) {
      return;
    }

    syncHandle = window.requestAnimationFrame(() => {
      syncHandle = 0;
      syncViewState(mapInstance);
    });
  };

  const markSceneReady = () => {
    if (sceneReady) {
      return;
    }

    sceneReady = true;
    mapInstance.resize();
    syncViewState(mapInstance);
    statusPill.textContent = mapState.stressModeActive
      ? "Performance mode active for dense street detail."
      : "Drag, scroll, pitch, or search to explore.";
    requestAnimationFrame(() => spinGlobe(mapInstance));
  };

  mapInstance.addControl(
    new maplibregl.AttributionControl({
      compact: true
    })
  );
  mapInstance.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
  mapInstance.addControl(new ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

  mapInstance.on("render", markSceneReady);
  mapInstance.on("load", () => {
    markSceneReady();
  });

  mapInstance.on("idle", () => {
    if (statusPill.classList.contains("is-error")) {
      return;
    }
    statusPill.textContent = mapState.stressModeActive
      ? "Performance mode active for dense street detail."
      : "Open-data globe active.";
  });

  mapInstance.on("movestart", () => {
    mapState.userInteracting = true;
  });

  mapInstance.on("moveend", () => {
    mapState.userInteracting = false;
    scheduleViewSync();
    spinGlobe(mapInstance);
  });

  mapInstance.on("move", () => {
    scheduleViewSync();
  });

  mapInstance.on("click", (event) => {
    const feature = mapInstance
      .queryRenderedFeatures(event.point, { layers: [...FEATURE_QUERY_LAYERS] })
      .find(Boolean);

    if (!feature) {
      activePopup?.remove();
      activePopup = null;
      return;
    }

    const title =
      pickString(feature.properties?.name) ??
      pickString(feature.properties?.["name_en"]) ??
      prettifyLayerName(feature.layer.id);
    const secondary = pickString(feature.properties?.class) ?? pickString(feature.properties?.type);
    const height = pickString(feature.properties?.render_height) ?? pickString(feature.properties?.height);
    const levels = pickString(feature.properties?.["building:levels"]);

    const detailParts = [secondary, height ? `${height} m` : undefined, levels ? `${levels} levels` : undefined]
      .filter(Boolean)
      .join(" · ");

    activePopup?.remove();
    activePopup = new Popup({
      closeButton: false,
      maxWidth: "260px",
      offset: 18
    })
      .setLngLat(event.lngLat)
      .setHTML(
        `
          <div class="popup-card">
            <strong>${escapeHtml(title)}</strong>
            ${detailParts ? `<span>${escapeHtml(detailParts)}</span>` : ""}
          </div>
        `
      )
      .addTo(mapInstance);
  });

  mapInstance.on("error", () => {
    statusPill.textContent = "Some external map tiles failed to load. The globe will keep trying.";
  });
}

function wireSearch(): void {
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (query.length < 2) {
      searchMessage.textContent = "Search needs at least two characters.";
      searchResults.replaceChildren();
      return;
    }

    searchMessage.textContent = "Searching open place data…";
    searchResults.replaceChildren();

    try {
      const results = await searchPlaces(query);
      if (results.length === 0) {
        searchMessage.textContent = "No matching places came back from the public geocoder.";
        return;
      }

      searchMessage.textContent = `Found ${results.length} result${results.length === 1 ? "" : "s"}.`;
      renderSearchResults(results);
    } catch (error) {
      searchMessage.textContent =
        error instanceof Error ? error.message : "Search failed against the public geocoder.";
    }
  });
}

function wirePresets(): void {
  presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const presetId = button.dataset.preset;
      const preset = PRESETS.find((entry) => entry.id === presetId);
      if (!preset || !map) {
        return;
      }

      statusPill.textContent = `Flying to ${preset.label}…`;
      activePopup?.remove();
      map.flyTo({
        center: [preset.lng, preset.lat],
        zoom: preset.zoom,
        pitch: preset.pitch,
        bearing: preset.bearing,
        speed: 0.85,
        curve: 1.32,
        essential: true
      });
    });
  });
}

function wireToggles(): void {
  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mapInstance = map;
      if (!mapInstance) {
        return;
      }

      const toggle = button.dataset.toggle;
      switch (toggle) {
        case "terrain":
          mapState.terrainEnabled = !mapState.terrainEnabled;
          mapInstance.setTerrain(mapState.terrainEnabled ? currentTerrainOptions(mapInstance) : null);
          button.classList.toggle("is-active", mapState.terrainEnabled);
          statusPill.textContent = mapState.terrainEnabled ? "Terrain enabled." : "Terrain flattened.";
          syncViewState(mapInstance);
          break;
        case "relief":
          mapState.reliefEnabled = !mapState.reliefEnabled;
          setReliefVisibility(mapInstance, mapState.reliefEnabled);
          button.classList.toggle("is-active", mapState.reliefEnabled);
          statusPill.textContent = mapState.reliefEnabled ? "Relief overlay enabled." : "Relief overlay hidden.";
          break;
        case "buildings":
          mapState.buildingsEnabled = !mapState.buildingsEnabled;
          setLayerVisibility(mapInstance, BUILDING_LAYER_ID, mapState.buildingsEnabled);
          setLayerVisibility(mapInstance, FLAT_BUILDING_LAYER_ID, mapState.buildingsEnabled);
          button.classList.toggle("is-active", mapState.buildingsEnabled);
          statusPill.textContent = mapState.buildingsEnabled ? "3D buildings enabled." : "Buildings hidden.";
          syncViewState(mapInstance);
          break;
        case "spin":
          mapState.autoSpinEnabled = !mapState.autoSpinEnabled;
          button.classList.toggle("is-active", mapState.autoSpinEnabled);
          statusPill.textContent = mapState.autoSpinEnabled ? "Orbital spin enabled." : "Orbital spin paused.";
          if (mapState.autoSpinEnabled) {
            spinGlobe(mapInstance);
          }
          break;
        default:
          break;
      }
    });
  });
}

function wireTraffic(mapInstance: Map): void {
  const controlDock = document.querySelector<HTMLElement>(".control-dock");
  if (!controlDock) return;

  const ui: TrafficUIElements = createTrafficUI(controlDock);
  let connectionStatus: "connecting" | "connected" | "disconnected" = "disconnected";
  let lastStatus: SnapshotStatus = {
    aircraft: { code: "ok", message: null },
    ships: { code: "ok", message: null }
  };

  const syncUI = () => {
    updateTrafficStatus(ui, connectionStatus, client.state.aircraftEnabled, client.state.shipsEnabled);
    updateTrafficCredit(ui, client.state.aircraftEnabled, client.state.shipsEnabled);
    updateLayerStatusHints(
      ui,
      lastStatus,
      client.state.aircraftEnabled,
      client.state.shipsEnabled,
      client.getLowZoomHint()
    );
  };

  const client = new TrafficClient(mapInstance, {
    onSnapshot: (snapshot) => {
      lastStatus = snapshot.status;
      updateTrafficData(mapInstance, snapshot);
      updateLayerAvailability(ui, snapshot.status);
      updateLayerStatusHints(
        ui,
        snapshot.status,
        client.state.aircraftEnabled,
        client.state.shipsEnabled,
        client.getLowZoomHint()
      );

      // Auto-disable layers that became unavailable
      let layersChanged = false;
      if (snapshot.status.aircraft.code === "unavailable" && client.state.aircraftEnabled) {
        client.state.aircraftEnabled = false;
        ui.aircraftToggle.classList.remove("is-active");
        clearAircraftData(mapInstance);
        layersChanged = true;
      }
      if (snapshot.status.ships.code === "unavailable" && client.state.shipsEnabled) {
        client.state.shipsEnabled = false;
        ui.shipsToggle.classList.remove("is-active");
        clearShipsData(mapInstance);
        layersChanged = true;
      }
      if (layersChanged) {
        client.sendSubscribe();
        syncUI();
      }
    },
    onStatusChange: (status) => {
      connectionStatus = status;
      updateTrafficStatus(ui, connectionStatus, client.state.aircraftEnabled, client.state.shipsEnabled);
    }
  });

  const handleToggle = (toggle: "aircraft" | "ships") => {
    if (toggle === "aircraft") {
      if (ui.aircraftToggle.disabled) return;
      client.state.aircraftEnabled = !client.state.aircraftEnabled;
      ui.aircraftToggle.classList.toggle("is-active", client.state.aircraftEnabled);
      if (!client.state.aircraftEnabled) clearAircraftData(mapInstance);
    } else {
      if (ui.shipsToggle.disabled) return;
      client.state.shipsEnabled = !client.state.shipsEnabled;
      ui.shipsToggle.classList.toggle("is-active", client.state.shipsEnabled);
      if (!client.state.shipsEnabled) clearShipsData(mapInstance);
    }

    client.setLayers(client.state.aircraftEnabled, client.state.shipsEnabled);
    syncUI();

    if (!client.state.aircraftEnabled && !client.state.shipsEnabled) {
      clearTrafficData(mapInstance);
    }
  };

  ui.aircraftToggle.addEventListener("click", () => handleToggle("aircraft"));
  ui.shipsToggle.addEventListener("click", () => handleToggle("ships"));

  // Add traffic sources/layers once style is loaded
  const addLayers = () => {
    if (!mapInstance.getSource("live-aircraft")) {
      addTrafficLayers(mapInstance);
    }
  };

  if (mapInstance.isStyleLoaded()) {
    addLayers();
  } else {
    mapInstance.on("load", addLayers);
  }

  // Send debounced subscribe on moveend
  mapInstance.on("moveend", () => {
    if (client.state.aircraftEnabled || client.state.shipsEnabled) {
      client.debouncedSubscribe();
    }
    syncUI();
  });
}

function renderSearchResults(results: SearchResult[]): void {
  const mapInstance = map;
  if (!mapInstance) {
    return;
  }

  const fragment = document.createDocumentFragment();
  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.innerHTML = `
      <strong>${escapeHtml(result.label)}</strong>
      <span>${formatCoordinates(result.lat, result.lng)}</span>
    `;
    button.addEventListener("click", () => {
      searchResults.replaceChildren();
      statusPill.textContent = `Flying to ${result.label}…`;

      if (result.bbox) {
        mapInstance.fitBounds(
          [
            [result.bbox[0], result.bbox[1]],
            [result.bbox[2], result.bbox[3]]
          ],
          {
            padding: 84,
            maxZoom: 16,
            duration: 1800
          }
        );
      } else {
        mapInstance.flyTo({
          center: [result.lng, result.lat],
          zoom: 15.2,
          pitch: 68,
          bearing: 24,
          speed: 0.9,
          curve: 1.28,
          essential: true
        });
      }
    });
    fragment.append(button);
  });

  searchResults.replaceChildren(fragment);
}

async function searchPlaces(query: string): Promise<SearchResult[]> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "geocodejson");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Geocoder returned ${response.status}.`);
  }

  const payload = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      bbox?: [number, number, number, number];
      properties?: { geocoding?: { label?: string } };
    }>;
  };

  return (payload.features ?? []).reduce<SearchResult[]>((results, feature) => {
    const coordinates = feature.geometry?.coordinates;
    if (!coordinates) {
      return results;
    }

    results.push({
      label: feature.properties?.geocoding?.label ?? "Unnamed location",
      lng: coordinates[0],
      lat: coordinates[1],
      bbox: feature.bbox
    });
    return results;
  }, []);
}

function spinGlobe(mapInstance: Map): void {
  if (!mapState.autoSpinEnabled || mapState.userInteracting) {
    return;
  }

  const zoom = mapInstance.getZoom();
  if (zoom > MAX_SPIN_ZOOM || !mapInstance.isStyleLoaded()) {
    return;
  }

  let distancePerSecond = 360 / SECONDS_PER_REVOLUTION;
  if (zoom > SLOW_SPIN_ZOOM) {
    const zoomFactor = (MAX_SPIN_ZOOM - zoom) / (MAX_SPIN_ZOOM - SLOW_SPIN_ZOOM);
    distancePerSecond *= Math.max(zoomFactor, 0);
  }

  const center = mapInstance.getCenter();
  mapInstance.easeTo({
    center: [center.lng - distancePerSecond, center.lat],
    duration: 1000,
    easing: (value) => value
  });
}

function syncMetrics(mapInstance: Map): void {
  const zoom = mapInstance.getZoom();
  const pitch = mapInstance.getPitch();
  const altitude = calculateApproxAltitude(mapInstance);
  const terrainHeight = getTerrainHeight(mapInstance);

  metricZoom.textContent = zoom.toFixed(2);
  metricPitch.textContent = `${pitch.toFixed(0)}°`;
  metricAltitude.textContent = formatDistance(altitude);
  metricTerrain.textContent = formatElevation(terrainHeight, mapState.terrainEnabled);
  metricMode.textContent = classifyView(zoom);
}

function syncViewState(mapInstance: Map): void {
  updateTerrainModel(mapInstance);
  updateProjectionMode(mapInstance);
  updateDetailProfile(mapInstance);
  updateSatelliteOpacity(mapInstance);
  syncMetrics(mapInstance);
}

function updateTerrainModel(mapInstance: Map): void {
  if (!mapState.terrainEnabled) {
    return;
  }

  const nextExaggeration = getTerrainExaggeration(mapInstance.getZoom());
  if (Math.abs(nextExaggeration - mapState.terrainExaggeration) < 0.01) {
    return;
  }

  mapState.terrainExaggeration = nextExaggeration;
  mapInstance.setTerrain(currentTerrainOptions(mapInstance));
}

function currentTerrainOptions(mapInstance: Map): { source: string; exaggeration: number } {
  const exaggeration = getTerrainExaggeration(mapInstance.getZoom());
  mapState.terrainExaggeration = exaggeration;
  return {
    source: TERRAIN_MESH_SOURCE_ID,
    exaggeration
  };
}

function updateProjectionMode(mapInstance: Map): void {
  const zoom = mapInstance.getZoom();
  let nextProjection = mapState.projectionMode;

  if (zoom >= MERCATOR_SWITCH_ZOOM) {
    nextProjection = "mercator";
  } else if (zoom <= GLOBE_RETURN_ZOOM) {
    nextProjection = "globe";
  }

  if (nextProjection === mapState.projectionMode) {
    return;
  }

  mapState.projectionMode = nextProjection;
  mapInstance.setProjection({ type: nextProjection });
}

function updateDetailProfile(mapInstance: Map): void {
  const zoom = mapInstance.getZoom();
  const pitch = mapInstance.getPitch();
  const shouldThrottle = shouldUsePerformanceMode(zoom, pitch);

  if (shouldThrottle === mapState.stressModeActive) {
    return;
  }

  mapState.stressModeActive = shouldThrottle;

  DENSE_SYMBOL_LAYER_IDS.forEach((layerId) => {
    setLayerVisibility(mapInstance, layerId, !shouldThrottle);
  });

  if (shouldThrottle) {
    activePopup?.remove();
    activePopup = null;
    statusPill.textContent = "Performance mode active for dense street detail.";
    return;
  }

  statusPill.textContent = "Open-data globe active.";
}

function setReliefVisibility(mapInstance: Map, visible: boolean): void {
  RELIEF_LAYER_IDS.forEach((layerId) => {
    setLayerVisibility(mapInstance, layerId, visible);
  });

  updateSatelliteOpacity(mapInstance);
}

function updateSatelliteOpacity(mapInstance: Map): void {
  if (!mapInstance.getLayer("satellite-imagery")) {
    return;
  }

  mapInstance.setPaintProperty(
    "satellite-imagery",
    "raster-opacity",
    getSatelliteOpacity(mapInstance.getZoom(), mapInstance.getPitch(), mapState.reliefEnabled)
  );
}

function calculateApproxAltitude(mapInstance: Map): number {
  const latitude = mapInstance.getCenter().lat * (Math.PI / 180);
  const metersPerPixel = (156543.03392 * Math.cos(latitude)) / Math.pow(2, mapInstance.getZoom());
  return metersPerPixel * (window.innerHeight / 2);
}

function getTerrainHeight(mapInstance: Map): number | null {
  if (!mapState.terrainEnabled) {
    return null;
  }

  const exaggeratedHeight = mapInstance.queryTerrainElevation(mapInstance.getCenter());
  if (exaggeratedHeight === null) {
    return null;
  }

  const exaggeration = mapInstance.getTerrain()?.exaggeration ?? 1;
  return normalizeTerrainElevation(exaggeratedHeight, exaggeration);
}

function classifyView(zoom: number): string {
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

function selectFillOpacity(layerId: string): number | unknown[] {
  if (layerId === "water") {
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.25,
      8,
      0.2,
      14,
      0.08
    ];
  }

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.08,
    10,
    0.05,
    14,
    0.02
  ];
}

function selectRoadOpacity(layerId: string): number | unknown[] {
  if (layerId.includes("casing")) {
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      5,
      0,
      10,
      0.22,
      16,
      0.45
    ];
  }

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    5,
    0,
    10,
    0.35,
    16,
    0.72
  ];
}

function setLayerVisibility(mapInstance: Map, layerId: string, visible: boolean): void {
  if (!mapInstance.getLayer(layerId)) {
    return;
  }

  mapInstance.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function pickString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === "number") {
    return value.toString();
  }

  return null;
}

function prettifyLayerName(layerId: string): string {
  return layerId.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }

  return `${Math.round(meters)} m`;
}

function formatElevation(meters: number | null, terrainEnabled: boolean): string {
  if (!terrainEnabled) {
    return "Off";
  }

  if (meters === null) {
    return "--";
  }

  return `${Math.round(meters)} m`;
}

function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

