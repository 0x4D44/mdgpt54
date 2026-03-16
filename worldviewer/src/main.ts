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
import { MAX_BROWSER_ZOOM } from "./detailProfile";
import { getTerrainExaggeration, normalizeTerrainElevation } from "./reliefProfile";
import { createSolarTerminatorOverlay } from "./overlays/solarTerminator";
import {
  createWeatherRadarOverlay,
  type WeatherRadarPresentation
} from "./overlays/weatherRadar";
import { TrafficClient } from "./traffic/trafficClient";
import { Aircraft3dController } from "./traffic/aircraft3dLayer";
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
import type { SnapshotMessage, SnapshotStatus, TrafficConnectionStatus } from "./traffic/trafficTypes";
import { createSearchRequestController } from "./searchRequestController";
import { buildMapStyle, BUILDING_LAYER_ID, FLAT_BUILDING_LAYER_ID } from "./mapStyle";
import type { MetricElements } from "./metricUI";
import type { MapState } from "./mapState";
import {
  syncViewState,
  syncSceneOverlays,
  setReliefVisibility,
  setLayerVisibility,
  spinGlobe,
  currentTerrainOptions,
  renderSceneOverlayPresentation,
  type SceneSyncDeps
} from "./sceneSync";
import { wireSearch } from "./searchUI";
import {
  parseHash,
  serializeHash,
  roundForHash,
  DEFAULTS,
  HASH_DEBOUNCE_MS,
  type CameraHashState
} from "./cameraHash";
import { debounce } from "./traffic/trafficHelpers";
import { createKeydownHandler } from "./keyboardNav";
import { createReadoutController, formatForClipboard } from "./coordinateReadout";

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

const TERRAIN_TILE_TEMPLATE_URL =
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
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
    id: "edinburgh",
    label: "Edinburgh",
    caption: "Castle ridge, Old Town density, Firth coastline.",
    lng: -3.1883,
    lat: 55.9533,
    zoom: 14.8,
    pitch: 68,
    bearing: -20
  },
  {
    id: "oxford",
    label: "Oxford",
    caption: "Historic college quads and the Thames meadows.",
    lng: -1.2578,
    lat: 51.752,
    zoom: 15.2,
    pitch: 72,
    bearing: 30
  },
  {
    id: "enfield",
    label: "Enfield",
    caption: "North London suburbs meeting green belt.",
    lng: -0.0824,
    lat: 51.6522,
    zoom: 14,
    pitch: 65,
    bearing: 10
  },
  {
    id: "seattle",
    label: "Seattle",
    caption: "Puget Sound waterfront with Cascade backdrop.",
    lng: -122.3321,
    lat: 47.6062,
    zoom: 14.6,
    pitch: 74,
    bearing: -15
  },
  {
    id: "tokyo",
    label: "Tokyo",
    caption: "Urban scale with terrain and dense road labels.",
    lng: 139.7591,
    lat: 35.6828,
    zoom: 15.6,
    pitch: 70,
    bearing: 36
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
    <aside id="control-dock" class="control-dock">
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
          <button type="button" class="toggle-chip is-active" data-toggle="terrain" aria-pressed="true">Terrain</button>
          <button type="button" class="toggle-chip is-active" data-toggle="relief" aria-pressed="true">Relief</button>
          <button type="button" class="toggle-chip is-active" data-toggle="night" aria-pressed="true">Night</button>
          <button type="button" class="toggle-chip" data-toggle="weather" aria-pressed="false">Weather</button>
          <button type="button" class="toggle-chip is-active" data-toggle="buildings" aria-pressed="true">3D Buildings</button>
          <button type="button" class="toggle-chip is-active" data-toggle="spin" aria-pressed="true">Orbit Spin</button>
        </div>
        <p id="scene-overlay-note" class="scene-overlay-note" hidden></p>
        <p id="scene-overlay-credit" class="scene-overlay-credit" hidden></p>
      </section>

      <section class="metric-section">
        <div class="section-head">
          <h2>Telemetry</h2>
          <span>Live view state</span>
        </div>
        <dl class="metric-grid">
          <div>
            <dt>Mode</dt>
            <dd id="metric-mode">Loading...</dd>
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
    <button
      id="dock-toggle"
      class="dock-toggle"
      type="button"
      aria-controls="control-dock"
      aria-expanded="true"
      aria-label="Hide side panel"
    >
      <
    </button>

    <div id="status-pill" class="status-pill">Loading open Earth layers...</div>
    <div id="coord-readout" class="coord-readout" hidden></div>
  </div>
`;

const mapContainer = document.querySelector<HTMLDivElement>("#map")!;
const statusPill = document.querySelector<HTMLDivElement>("#status-pill")!;
const searchForm = document.querySelector<HTMLFormElement>("#search-form")!;
const searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
const searchMessage = document.querySelector<HTMLParagraphElement>("#search-message")!;
const searchResults = document.querySelector<HTMLDivElement>("#search-results")!;
const coordReadout = document.querySelector<HTMLDivElement>("#coord-readout")!;
const metricMode = document.querySelector<HTMLElement>("#metric-mode")!;
const metricZoom = document.querySelector<HTMLElement>("#metric-zoom")!;
const metricAltitude = document.querySelector<HTMLElement>("#metric-altitude")!;
const metricPitch = document.querySelector<HTMLElement>("#metric-pitch")!;
const metricTerrain = document.querySelector<HTMLElement>("#metric-terrain")!;
const controlDock = document.querySelector<HTMLElement>("#control-dock")!;
const dockToggle = document.querySelector<HTMLButtonElement>("#dock-toggle")!;
const sceneOverlayNote = document.querySelector<HTMLElement>("#scene-overlay-note")!;
const sceneOverlayCredit = document.querySelector<HTMLElement>("#scene-overlay-credit")!;
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-preset]"));
const toggleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-toggle]"));
const metricElements: MetricElements = {
  metricMode,
  metricZoom,
  metricAltitude,
  metricPitch,
  metricTerrain
};
const searchRequests = createSearchRequestController();
const solarTerminator = createSolarTerminatorOverlay();
let weatherRadarPresentation: WeatherRadarPresentation = {
  note: null,
  creditLabel: null
};
const weatherRadar = createWeatherRadarOverlay({
  onStateChange: (presentation) => {
    weatherRadarPresentation = presentation;
    renderSceneOverlayPresentation(sceneSyncDeps);
  }
});

const mapState: MapState = {
  terrainEnabled: true,
  buildingsEnabled: true,
  reliefEnabled: true,
  nightEnabled: true,
  weatherEnabled: false,
  autoSpinEnabled: true,
  userInteracting: false,
  stressModeActive: false,
  terrainExaggeration: getTerrainExaggeration(1.2),
  projectionMode: "globe"
};

let map: Map | null = null;
let activePopup: Popup | null = null;

const dismissPopup = () => {
  activePopup?.remove();
  activePopup = null;
};

const sceneSyncDeps: SceneSyncDeps = {
  mapState,
  statusPill,
  metricElements,
  solarTerminator,
  weatherRadar,
  dismissPopup,
  getWeatherRadarPresentation: () => weatherRadarPresentation,
  sceneOverlayNote,
  sceneOverlayCredit
};

/** Build the current camera + toggle state for the URL hash. */
function currentHashState(): CameraHashState {
  const mapInstance = map;
  if (!mapInstance) return {};
  const center = mapInstance.getCenter();
  return {
    lat: roundForHash(center.lat, 4),
    lng: roundForHash(center.lng, 4),
    z: roundForHash(mapInstance.getZoom(), 1),
    p: roundForHash(mapInstance.getPitch(), 0),
    b: roundForHash(mapInstance.getBearing(), 0),
    terrain: mapState.terrainEnabled,
    buildings: mapState.buildingsEnabled,
    relief: mapState.reliefEnabled,
    night: mapState.nightEnabled,
    weather: mapState.weatherEnabled,
    spin: mapState.autoSpinEnabled
  };
}

const updateHash = debounce(() => {
  const hash = serializeHash(currentHashState());
  history.replaceState(null, "", hash || window.location.pathname + window.location.search);
}, HASH_DEBOUNCE_MS);

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    wireDockToggle();

    // Apply deep-link hash state to initial camera + toggles
    const hashState = parseHash(window.location.hash);
    applyHashToggles(hashState);

    const demSource = new mlcontour.DemSource({
      url: TERRAIN_TILE_TEMPLATE_URL,
      encoding: "terrarium",
      maxzoom: 15,
      worker: true,
      cacheSize: 128,
      timeoutMs: 12000
    });
    demSource.setupMaplibre(maplibregl);

    const style = await buildMapStyle(demSource, {
      reliefEnabled: mapState.reliefEnabled,
      terrainExaggeration: mapState.terrainExaggeration
    });
    map = createMap(style, hashState);
    wireMap(map);
    wireSearch({
      searchForm,
      searchInput,
      searchMessage,
      searchResults,
      statusPill,
      getMap: () => map,
      searchRequests
    });
    wirePresets();
    wireToggles();
    syncSceneOverlays(map, sceneSyncDeps);
    wireTraffic(map);

    document.addEventListener("keydown", createKeydownHandler({
      isInputFocused: () => document.activeElement === searchInput,
      toggleByName: (name) => {
        const btn = toggleButtons.find((b) => b.dataset.toggle === name)
          ?? document.querySelector<HTMLButtonElement>(`[data-toggle="${name}"]`)
          ?? document.querySelector<HTMLButtonElement>(`[data-traffic-toggle="${name}"]`);
        btn?.click();
      },
      activatePreset: (index) => {
        presetButtons[index]?.click();
      },
      closePopup: () => {
        if (document.activeElement === searchInput) {
          searchInput.blur();
        }
        dismissPopup();
      },
      focusSearch: () => {
        searchInput.focus();
      }
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the globe.";
    statusPill.textContent = message;
    statusPill.classList.add("is-error");
  }
}

function wireDockToggle(): void {
  let expanded = true;

  const sync = () => {
    controlDock.classList.toggle("is-collapsed", !expanded);
    dockToggle.classList.toggle("is-collapsed", !expanded);
    dockToggle.textContent = expanded ? "<" : ">";
    dockToggle.setAttribute("aria-expanded", String(expanded));
    dockToggle.setAttribute("aria-label", expanded ? "Hide side panel" : "Show side panel");
  };

  dockToggle.addEventListener("click", () => {
    expanded = !expanded;
    sync();
  });

  sync();
}

/** Apply parsed hash toggle values to mapState and sync toggle chip classes. */
function applyHashToggles(hashState: CameraHashState): void {
  const toggles: Array<{
    hashKey: keyof CameraHashState;
    apply: (v: boolean) => void;
    chipName: string;
  }> = [
    { hashKey: "terrain", apply: (v) => { mapState.terrainEnabled = v; }, chipName: "terrain" },
    { hashKey: "buildings", apply: (v) => { mapState.buildingsEnabled = v; }, chipName: "buildings" },
    { hashKey: "relief", apply: (v) => { mapState.reliefEnabled = v; }, chipName: "relief" },
    { hashKey: "night", apply: (v) => { mapState.nightEnabled = v; }, chipName: "night" },
    { hashKey: "weather", apply: (v) => { mapState.weatherEnabled = v; }, chipName: "weather" },
    { hashKey: "spin", apply: (v) => { mapState.autoSpinEnabled = v; }, chipName: "spin" }
  ];

  for (const { hashKey, apply, chipName } of toggles) {
    const value = hashState[hashKey];
    if (typeof value !== "boolean") continue;
    apply(value);
    const chip = toggleButtons.find((btn) => btn.dataset.toggle === chipName);
    chip?.classList.toggle("is-active", value);
    chip?.setAttribute("aria-pressed", String(value));
  }

  // Recalculate terrain exaggeration for the hash zoom if provided
  if (hashState.z !== undefined) {
    mapState.terrainExaggeration = getTerrainExaggeration(hashState.z);
  }
}

function createMap(style: StyleSpecification, hashState: CameraHashState): Map {
  return new maplibregl.Map({
    container: mapContainer,
    style,
    center: [hashState.lng ?? DEFAULTS.lng, hashState.lat ?? DEFAULTS.lat],
    zoom: hashState.z ?? DEFAULTS.z,
    pitch: hashState.p ?? DEFAULTS.p,
    bearing: hashState.b ?? DEFAULTS.b,
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
      syncViewState(mapInstance, sceneSyncDeps);
    });
  };

  const markSceneReady = () => {
    if (sceneReady) {
      return;
    }

    sceneReady = true;
    mapInstance.resize();
    syncViewState(mapInstance, sceneSyncDeps);
    statusPill.textContent = mapState.stressModeActive
      ? "Performance mode active for dense street detail."
      : "Drag, scroll, pitch, or search to explore.";
    requestAnimationFrame(() => spinGlobe(mapInstance, mapState));
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
    spinGlobe(mapInstance, mapState);
    updateHash();
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
      .join(" | ");

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

  // Coordinate readout: show lat/lng + elevation under cursor
  let readoutRevealed = false;
  let lastCursorLat = 0;
  let lastCursorLng = 0;
  const readoutController = createReadoutController({
    getElevation: (lngLat) => {
      if (!mapState.terrainEnabled) return null;
      const raw = mapInstance.queryTerrainElevation(lngLat);
      if (raw === null) return null;
      return normalizeTerrainElevation(raw, mapState.terrainExaggeration);
    },
    onUpdate: (text) => {
      coordReadout.textContent = text;
    }
  });

  mapInstance.on("mousemove", (event) => {
    if (!readoutRevealed) {
      readoutRevealed = true;
      coordReadout.hidden = false;
    }
    lastCursorLat = event.lngLat.lat;
    lastCursorLng = event.lngLat.lng;
    readoutController.handleMouseMove(event);
  });

  coordReadout.addEventListener("click", () => {
    const text = formatForClipboard(lastCursorLat, lastCursorLng);
    void navigator.clipboard.writeText(text).then(() => {
      statusPill.textContent = "Copied!";
    });
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

      statusPill.textContent = `Flying to ${preset.label}...`;
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
          mapInstance.setTerrain(mapState.terrainEnabled ? currentTerrainOptions(mapInstance, mapState) : null);
          button.classList.toggle("is-active", mapState.terrainEnabled);
          statusPill.textContent = mapState.terrainEnabled ? "Terrain enabled." : "Terrain flattened.";
          syncViewState(mapInstance, sceneSyncDeps);
          break;
        case "relief":
          mapState.reliefEnabled = !mapState.reliefEnabled;
          setReliefVisibility(mapInstance, mapState.reliefEnabled, mapState);
          button.classList.toggle("is-active", mapState.reliefEnabled);
          statusPill.textContent = mapState.reliefEnabled ? "Relief overlay enabled." : "Relief overlay hidden.";
          break;
        case "buildings":
          mapState.buildingsEnabled = !mapState.buildingsEnabled;
          setLayerVisibility(mapInstance, BUILDING_LAYER_ID, mapState.buildingsEnabled);
          setLayerVisibility(mapInstance, FLAT_BUILDING_LAYER_ID, mapState.buildingsEnabled);
          button.classList.toggle("is-active", mapState.buildingsEnabled);
          statusPill.textContent = mapState.buildingsEnabled ? "3D buildings enabled." : "Buildings hidden.";
          syncViewState(mapInstance, sceneSyncDeps);
          break;
        case "night":
          mapState.nightEnabled = !mapState.nightEnabled;
          button.classList.toggle("is-active", mapState.nightEnabled);
          syncSceneOverlays(mapInstance, sceneSyncDeps);
          statusPill.textContent = mapState.nightEnabled ? "Night overlay enabled." : "Night overlay hidden.";
          break;
        case "weather":
          mapState.weatherEnabled = !mapState.weatherEnabled;
          button.classList.toggle("is-active", mapState.weatherEnabled);
          syncSceneOverlays(mapInstance, sceneSyncDeps);
          statusPill.textContent = mapState.weatherEnabled ? "Weather radar enabled." : "Weather radar hidden.";
          break;
        case "spin":
          mapState.autoSpinEnabled = !mapState.autoSpinEnabled;
          button.classList.toggle("is-active", mapState.autoSpinEnabled);
          statusPill.textContent = mapState.autoSpinEnabled ? "Orbital spin enabled." : "Orbital spin paused.";
          if (mapState.autoSpinEnabled) {
            spinGlobe(mapInstance, mapState);
          }
          break;
        default:
          break;
      }

      button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
      updateHash();
    });
  });
}

function wireTraffic(mapInstance: Map): void {
  const ui: TrafficUIElements = createTrafficUI(controlDock);
  let connectionStatus: TrafficConnectionStatus = "disconnected";
  let lastStatus: SnapshotStatus = {
    aircraft: { code: "ok", message: null },
    ships: { code: "ok", message: null }
  };
  let latestSnapshot: SnapshotMessage = {
    type: "snapshot",
    aircraft: [],
    ships: [],
    serverTime: Date.now(),
    status: lastStatus
  };
  let aircraft3d: Aircraft3dController | null = null;

  const refreshTrafficPresentation = () => {
    if (!mapInstance.getSource("live-aircraft")) {
      return;
    }

    updateTrafficData(mapInstance, latestSnapshot, aircraft3d?.getHiddenTrackIds());
  };

  const ensureAircraft3d = () => {
    if (!aircraft3d) {
      aircraft3d = new Aircraft3dController(mapInstance, refreshTrafficPresentation);
    }

    return aircraft3d;
  };

  const syncUI = () => {
    updateTrafficStatus(ui, connectionStatus, client.state.aircraftEnabled, client.state.shipsEnabled);
    updateTrafficCredit(ui, client.state.aircraftEnabled, client.state.shipsEnabled);
    updateLayerStatusHints(
      ui,
      lastStatus,
      client.state.aircraftEnabled,
      client.state.shipsEnabled,
      client.getClientHint()
    );
  };

  const client = new TrafficClient(mapInstance, {
    onSnapshot: (snapshot) => {
      latestSnapshot = snapshot;
      lastStatus = snapshot.status;
      if (mapInstance.getSource("live-aircraft")) {
        ensureAircraft3d().setTracks(snapshot.aircraft);
      }
      updateTrafficData(mapInstance, snapshot, aircraft3d?.getHiddenTrackIds());
      updateLayerAvailability(ui, snapshot.status);
      updateLayerStatusHints(
        ui,
        snapshot.status,
        client.state.aircraftEnabled,
        client.state.shipsEnabled,
        client.getClientHint()
      );
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
      ui.aircraftToggle.setAttribute("aria-pressed", String(client.state.aircraftEnabled));
      if (!client.state.aircraftEnabled) {
        aircraft3d?.setTracks([]);
        clearAircraftData(mapInstance);
      }
    } else {
      if (ui.shipsToggle.disabled) return;
      client.state.shipsEnabled = !client.state.shipsEnabled;
      ui.shipsToggle.classList.toggle("is-active", client.state.shipsEnabled);
      ui.shipsToggle.setAttribute("aria-pressed", String(client.state.shipsEnabled));
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
    ensureAircraft3d().setTracks(latestSnapshot.aircraft);
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
