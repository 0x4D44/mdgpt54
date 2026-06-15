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
  createTimeScrubber,
  dateFromSliderValue,
  sliderValueFromDate,
  formatScrubberLabel
} from "./overlays/timeScrubber";
import {
  createWeatherRadarOverlay,
  type WeatherRadarPresentation
} from "./overlays/weatherRadar";
import {
  createEarthquakeOverlay,
  type EarthquakePresentation
} from "./overlays/earthquakeOverlay";
import {
  createIssTrackerOverlay,
  type IssPresentation
} from "./overlays/issTracker";
import { createMeasureTool, type MeasureState, type MeasureResult } from "./overlays/measureTool";
import { formatDistance, formatBearing } from "./overlays/measureGeodesic";
import { TrafficClient } from "./traffic/trafficClient";
import { Aircraft3dController } from "./traffic/aircraft3dLayer";
import {
  addTrafficLayers,
  clearAircraftData,
  clearShipsData,
  clearTrafficData,
  updateTrafficData,
  updateTrailData
} from "./traffic/trafficLayers";
import { createTrailStore } from "./traffic/aircraftTrails";
import { extrapolateTracks, MAX_EXTRAPOLATION_MS } from "./traffic/aircraftAnimator";
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
  spinGlobe,
  renderSceneOverlayPresentation,
  type SceneSyncDeps
} from "./sceneSync";
import { wireSearch } from "./searchUI";
import { TOGGLES, dispatchToggle } from "./sceneToggles";
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
import { loadBookmarks, saveBookmarks, createBookmark, removeBookmark, MAX_BOOKMARKS } from "./bookmarks";

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
          <button id="save-view-btn" type="button" class="save-view-btn">Save View</button>
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
          <button type="button" class="toggle-chip" data-toggle="earthquakes" aria-pressed="false">Quakes</button>
          <button type="button" class="toggle-chip" data-toggle="iss" aria-pressed="false">ISS</button>
          <button type="button" class="toggle-chip is-active" data-toggle="buildings" aria-pressed="true">3D Buildings</button>
          <button type="button" class="toggle-chip is-active" data-toggle="spin" aria-pressed="true">Orbit Spin</button>
          <button type="button" class="toggle-chip" data-toggle="measure" aria-pressed="false">Measure</button>
        </div>
        <div id="time-scrubber" class="time-scrubber" hidden>
          <label class="time-scrubber-label" for="time-slider" id="time-scrubber-label">--:-- UTC</label>
          <input id="time-slider" type="range" min="0" max="1440" step="1" value="720" />
          <button id="time-scrubber-reset" type="button" class="time-scrubber-reset">Reset to live</button>
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
const timeScrubberContainer = document.querySelector<HTMLDivElement>("#time-scrubber")!;
const timeSlider = document.querySelector<HTMLInputElement>("#time-slider")!;
const timeScrubberLabel = document.querySelector<HTMLElement>("#time-scrubber-label")!;
const timeScrubberResetBtn = document.querySelector<HTMLButtonElement>("#time-scrubber-reset")!;
const presetGrid = document.querySelector<HTMLDivElement>(".preset-grid")!;
const saveViewBtn = document.querySelector<HTMLButtonElement>("#save-view-btn")!;
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
const timeScrubber = createTimeScrubber({
  onDateChange: (date) => {
    if (date) {
      solarTerminator.setGetNow(() => date);
      timeScrubberLabel.textContent = formatScrubberLabel(date);
    } else {
      solarTerminator.setGetNow(() => new Date());
      timeScrubberLabel.textContent = formatScrubberLabel(new Date());
    }
  }
});
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

let earthquakePresentation: EarthquakePresentation = {
  note: null,
  creditLabel: null
};
const earthquakeOverlay = createEarthquakeOverlay({
  onStateChange: (presentation) => {
    earthquakePresentation = presentation;
    renderSceneOverlayPresentation(sceneSyncDeps);
  }
});

let issPresentation: IssPresentation = { note: null };
const issTracker = createIssTrackerOverlay({
  onStateChange: (presentation) => {
    issPresentation = presentation;
    renderSceneOverlayPresentation(sceneSyncDeps);
  }
});

let measureNote: string | null = null;
const measureTool = createMeasureTool({
  onStateChange: (_state: MeasureState, result: MeasureResult | null) => {
    measureNote = result
      ? `${formatDistance(result.distanceMeters)} · ${formatBearing(result.bearingDegrees)}`
      : null;
    renderSceneOverlayPresentation(sceneSyncDeps);
  }
});

const mapState: MapState = {
  terrainEnabled: true,
  buildingsEnabled: true,
  reliefEnabled: true,
  nightEnabled: true,
  weatherEnabled: false,
  earthquakeEnabled: false,
  issEnabled: false,
  measureEnabled: false,
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
  earthquakeOverlay,
  issTracker,
  measureTool,
  dismissPopup,
  getWeatherRadarPresentation: () => weatherRadarPresentation,
  getEarthquakePresentation: () => earthquakePresentation,
  getIssPresentation: () => issPresentation,
  getMeasureNote: () => measureNote,
  sceneOverlayNote,
  sceneOverlayCredit
};

/** Build the current camera + toggle state for the URL hash. */
function currentHashState(): CameraHashState {
  const mapInstance = map;
  if (!mapInstance) return {};
  const center = mapInstance.getCenter();
  const state: CameraHashState = {
    lat: roundForHash(center.lat, 4),
    lng: roundForHash(center.lng, 4),
    z: roundForHash(mapInstance.getZoom(), 1),
    p: roundForHash(mapInstance.getPitch(), 0),
    b: roundForHash(mapInstance.getBearing(), 0)
  };
  for (const def of TOGGLES) {
    if (!def.hashKey) continue;
    state[def.hashKey] = mapState[def.stateKey];
  }
  return state;
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
    wireBookmarks();
    wireToggles();
    wireTimeScrubber();
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
  for (const def of TOGGLES) {
    if (!def.hashKey) continue;
    const value = hashState[def.hashKey];
    if (typeof value !== "boolean") continue;
    mapState[def.stateKey] = value;
    const chip = toggleButtons.find((btn) => btn.dataset.toggle === def.name);
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
    // Suppress feature popups while measurement mode is active
    if (mapState.measureEnabled) return;

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

function wireBookmarks(): void {
  let bookmarks = loadBookmarks();

  const renderBookmarkCards = () => {
    // Remove existing bookmark cards
    presetGrid.querySelectorAll("[data-bookmark-id]").forEach((el) => el.remove());

    for (const bm of bookmarks) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "preset-card";
      card.setAttribute("data-bookmark-id", bm.id);
      card.innerHTML =
        `<strong>${escapeHtml(bm.label)}</strong>` +
        `<span>${escapeHtml(bm.caption)}</span>` +
        `<button type="button" class="bookmark-delete" aria-label="Delete bookmark">\u00d7</button>`;

      // Click card → fly to bookmark
      card.addEventListener("click", () => {
        if (!map) return;
        statusPill.textContent = `Flying to ${escapeHtml(bm.label)}...`;
        activePopup?.remove();
        map.flyTo({
          center: [bm.lng, bm.lat],
          zoom: bm.zoom,
          pitch: bm.pitch,
          bearing: bm.bearing,
          speed: 0.85,
          curve: 1.32,
          essential: true
        });
      });

      // Delete button
      const deleteBtn = card.querySelector<HTMLButtonElement>(".bookmark-delete")!;
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        bookmarks = removeBookmark(bookmarks, bm.id);
        saveBookmarks(bookmarks);
        renderBookmarkCards();
      });

      presetGrid.appendChild(card);
    }
  };

  saveViewBtn.addEventListener("click", () => {
    if (!map) return;
    const name = window.prompt("Bookmark name:");
    if (!name || !name.trim()) return;

    const center = map.getCenter();
    const bm = createBookmark(name.trim(), {
      lng: center.lng,
      lat: center.lat,
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing()
    });

    if (bookmarks.length >= MAX_BOOKMARKS) {
      statusPill.textContent = `Bookmark limit (${MAX_BOOKMARKS}) reached.`;
      return;
    }

    bookmarks = [...bookmarks, bm];
    saveBookmarks(bookmarks);
    renderBookmarkCards();
    statusPill.textContent = `Saved "${escapeHtml(bm.label)}".`;
  });

  renderBookmarkCards();
}

function wireToggles(): void {
  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mapInstance = map;
      if (!mapInstance) {
        return;
      }

      const toggle = button.dataset.toggle;
      if (toggle === undefined) {
        return;
      }

      const result = dispatchToggle(toggle, {
        map: mapInstance,
        mapState,
        sceneSyncDeps,
        syncTimeScrubberVisibility
      });
      if (!result) {
        return;
      }

      button.classList.toggle("is-active", result.on);
      statusPill.textContent = result.status;
      button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
      updateHash();
    });
  });
}

function syncTimeScrubberVisibility(): void {
  timeScrubberContainer.hidden = !mapState.nightEnabled;
  if (!mapState.nightEnabled) {
    timeScrubber.resetToLive();
    timeSlider.value = String(sliderValueFromDate(new Date()));
  }
}

function wireTimeScrubber(): void {
  // Initialize slider to current time
  const now = new Date();
  timeSlider.value = String(sliderValueFromDate(now));
  timeScrubberLabel.textContent = formatScrubberLabel(now);

  // Update on slider input (fires continuously while dragging)
  timeSlider.addEventListener("input", () => {
    const value = Number(timeSlider.value);
    const date = dateFromSliderValue(value);
    timeScrubber.setOverride(date);
  });

  // Reset to live button
  timeScrubberResetBtn.addEventListener("click", () => {
    timeScrubber.resetToLive();
    const nowDate = new Date();
    timeSlider.value = String(sliderValueFromDate(nowDate));
    timeScrubberLabel.textContent = formatScrubberLabel(nowDate);
  });

  // Match initial visibility to night toggle state
  syncTimeScrubberVisibility();
}

function wireTraffic(mapInstance: Map): void {
  const ui: TrafficUIElements = createTrafficUI(controlDock);
  const trailStore = createTrailStore();
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

  // Smooth-glide animation loop: between 15s polls we dead-reckon each aircraft
  // forward from its last fix so icons glide instead of jumping. Throttled to
  // ~80ms and only runs while aircraft are enabled and present.
  const ANIMATION_FRAME_MS = 80;
  let animationHandle = 0;
  let lastFrameTime = 0;

  const animationActive = () =>
    client.state.aircraftEnabled && latestSnapshot.aircraft.length > 0;

  const animationTick = (timestamp: number) => {
    animationHandle = requestAnimationFrame(animationTick);

    if (!animationActive() || timestamp - lastFrameTime < ANIMATION_FRAME_MS) {
      return;
    }
    lastFrameTime = timestamp;

    if (!mapInstance.getSource("live-aircraft")) {
      return;
    }

    const animated = extrapolateTracks(latestSnapshot.aircraft, Date.now(), MAX_EXTRAPOLATION_MS);
    updateTrafficData(mapInstance, { ...latestSnapshot, aircraft: animated }, aircraft3d?.getHiddenTrackIds());
    aircraft3d?.setTracks(animated);
  };

  const startAnimationLoop = () => {
    if (typeof requestAnimationFrame === "undefined" || animationHandle !== 0) {
      return;
    }
    animationHandle = requestAnimationFrame(animationTick);
  };

  const stopAnimationLoop = () => {
    if (animationHandle !== 0 && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(animationHandle);
    }
    animationHandle = 0;
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
      const now = Date.now();
      trailStore.update(snapshot.aircraft, now);
      updateTrailData(mapInstance, trailStore.toGeoJSON(now));
      updateTrafficData(mapInstance, snapshot, aircraft3d?.getHiddenTrackIds());
      // Kick off the smooth-glide loop once we have aircraft to animate; it
      // self-gates per frame and the per-snapshot calls above ensure an
      // immediate render even before the first animated frame fires.
      if (animationActive()) {
        startAnimationLoop();
      }
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
      if (client.state.aircraftEnabled) {
        startAnimationLoop();
      } else {
        stopAnimationLoop();
        aircraft3d?.setTracks([]);
        trailStore.clear();
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
