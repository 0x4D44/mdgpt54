import type { Map } from "maplibre-gl";

import { openSkyUrl, parseOpenSkyStates } from "./openskyDirect";
import {
  MIN_LIVE_TRAFFIC_ZOOM,
  bboxFromBounds,
  debounce,
  getTrafficClientHint,
  isStaticTrafficHost,
  parseSnapshot,
  resolveEffectiveTrafficLayers,
  type TrafficToggleState
} from "./trafficHelpers";
import {
  resolveLocalTrafficStatus,
  summarizeConnectionStatus,
  type AircraftRuntimeState,
  type ShipRuntimeState
} from "./trafficRuntime";
import type {
  Bbox,
  LiveTrack,
  SnapshotMessage,
  SnapshotStatus,
  SubscribeMessage,
  TrafficConnectionStatus
} from "./trafficTypes";

export type TrafficClientState = TrafficToggleState;

export type TrafficClientCallbacks = {
  onSnapshot: (snapshot: SnapshotMessage) => void;
  onStatusChange: (status: TrafficConnectionStatus) => void;
};

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const SUBSCRIBE_DEBOUNCE_MS = 300;
const OPENSKY_POLL_MS = 15_000;

export class TrafficClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private aircraftPollTimer: ReturnType<typeof setTimeout> | null = null;
  private aircraftAbort: AbortController | null = null;
  private aircraftFetchInFlight = false;
  private lastAircraftPollAt = 0;
  private lastAircraftBbox: Bbox | null = null;
  private disposed = false;
  private readonly map: Map;
  private readonly callbacks: TrafficClientCallbacks;
  private latestAircraft: LiveTrack[] = [];
  private latestShips: LiveTrack[] = [];
  private shipStatus: SnapshotStatus["ships"] = { code: "ok", message: null };
  private aircraftRuntime: AircraftRuntimeState = "off";
  private shipRuntime: ShipRuntimeState = "off";
  private lastConnectionStatus: TrafficConnectionStatus | null = null;
  readonly state: TrafficClientState;

  /** Debounced version of sendSubscribe bound to moveend. */
  readonly debouncedSubscribe: () => void;

  constructor(map: Map, callbacks: TrafficClientCallbacks) {
    this.map = map;
    this.callbacks = callbacks;
    this.state = { aircraftEnabled: false, shipsEnabled: false };
    this.debouncedSubscribe = debounce(() => this.sendSubscribe(), SUBSCRIBE_DEBOUNCE_MS);
  }

  /** Sync browser-side aircraft polling and ship relay subscriptions. */
  connect(): void {
    if (this.disposed) return;
    this.syncTransports(true);
  }

  /** Send a subscribe/update message for the current viewport. */
  sendSubscribe(): void {
    if (this.disposed) return;
    this.syncTransports(true);
  }

  /** Update toggle state and immediately sync direct/relay transports. */
  setLayers(aircraft: boolean, ships: boolean): void {
    this.state.aircraftEnabled = aircraft;
    this.state.shipsEnabled = ships;
    this.syncTransports(true);
  }

  /** Whether the ship websocket is currently open. */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Tear down the client and stop reconnection/polling. */
  dispose(): void {
    this.disposed = true;
    this.stopAircraftPolling();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getClientHint(): string | null {
    return getTrafficClientHint(this.state, this.map.getZoom(), location.hostname);
  }

  private syncTransports(forceAircraftRefresh: boolean): void {
    this.syncAircraft(forceAircraftRefresh);
    this.syncShips();
    this.publishSnapshot();
    this.publishConnectionStatus();
  }

  private syncAircraft(forceRefresh: boolean): void {
    if (!this.state.aircraftEnabled) {
      this.stopAircraftPolling();
      this.latestAircraft = [];
      this.aircraftRuntime = "off";
      this.lastAircraftBbox = null;
      return;
    }

    if (!this.isAircraftActive()) {
      this.stopAircraftPolling();
      this.latestAircraft = [];
      this.aircraftRuntime = "zoom_blocked";
      this.lastAircraftBbox = null;
      return;
    }

    if (this.aircraftRuntime === "off" || this.aircraftRuntime === "zoom_blocked") {
      this.aircraftRuntime = this.latestAircraft.length > 0 ? "live" : "loading";
    }

    void this.pollAircraftIfNeeded(forceRefresh);
    this.ensureAircraftPollTimer();
  }

  private async pollAircraftIfNeeded(forceRefresh: boolean): Promise<void> {
    if (!this.isAircraftActive() || this.disposed || this.aircraftFetchInFlight) {
      return;
    }

    const bbox = bboxFromBounds(this.map.getBounds());
    const now = Date.now();
    const bboxChanged = !sameBbox(this.lastAircraftBbox, bbox);
    const isStale = now - this.lastAircraftPollAt >= OPENSKY_POLL_MS;
    const shouldPoll =
      this.latestAircraft.length === 0 || isStale || (forceRefresh && bboxChanged);

    if (!shouldPoll) {
      this.ensureAircraftPollTimer();
      return;
    }

    await this.pollAircraft(bbox);
  }

  private async pollAircraft(bbox: Bbox): Promise<void> {
    if (!this.isAircraftActive() || this.disposed) {
      return;
    }

    this.stopAircraftRequest();
    this.aircraftFetchInFlight = true;
    this.aircraftRuntime = this.latestAircraft.length > 0 ? "live" : "loading";
    this.publishConnectionStatus();

    const abortController = new AbortController();
    this.aircraftAbort = abortController;

    try {
      const response = await fetch(openSkyUrl(bbox), {
        headers: {
          Accept: "application/json"
        },
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`OpenSky returned ${response.status}.`);
      }

      const payload = (await response.json()) as unknown;
      if (this.disposed || abortController.signal.aborted) {
        return;
      }

      const now = Date.now();
      this.latestAircraft = parseOpenSkyStates(payload, now);
      this.lastAircraftPollAt = now;
      this.lastAircraftBbox = bbox;
      this.aircraftRuntime = "live";
    } catch (error) {
      if (abortController.signal.aborted || this.disposed) {
        return;
      }

      console.warn("[opensky] browser poll error:", error);
      this.latestAircraft = [];
      this.aircraftRuntime = "error";
    } finally {
      if (this.aircraftAbort === abortController) {
        this.aircraftAbort = null;
      }
      this.aircraftFetchInFlight = false;
      this.ensureAircraftPollTimer();
      this.publishSnapshot();
      this.publishConnectionStatus();
    }
  }

  private ensureAircraftPollTimer(): void {
    if (!this.isAircraftActive() || this.disposed || this.aircraftPollTimer || this.aircraftFetchInFlight) {
      return;
    }

    const elapsed = this.lastAircraftPollAt === 0 ? OPENSKY_POLL_MS : Date.now() - this.lastAircraftPollAt;
    const delay = this.lastAircraftPollAt === 0 ? OPENSKY_POLL_MS : Math.max(0, OPENSKY_POLL_MS - elapsed);

    this.aircraftPollTimer = setTimeout(() => {
      this.aircraftPollTimer = null;
      void this.pollAircraftIfNeeded(true);
    }, delay);
  }

  private stopAircraftPolling(): void {
    if (this.aircraftPollTimer !== null) {
      clearTimeout(this.aircraftPollTimer);
      this.aircraftPollTimer = null;
    }

    this.stopAircraftRequest();
    this.aircraftFetchInFlight = false;
  }

  private stopAircraftRequest(): void {
    if (this.aircraftAbort) {
      this.aircraftAbort.abort();
      this.aircraftAbort = null;
    }
  }

  private syncShips(): void {
    if (!this.state.shipsEnabled) {
      this.disconnectRelay();
      this.latestShips = [];
      this.shipStatus = { code: "ok", message: null };
      this.shipRuntime = "off";
      return;
    }

    if (this.map.getZoom() < MIN_LIVE_TRAFFIC_ZOOM) {
      this.disconnectRelay();
      this.latestShips = [];
      this.shipStatus = { code: "ok", message: null };
      this.shipRuntime = "zoom_blocked";
      return;
    }

    if (isStaticTrafficHost(location.hostname)) {
      this.disconnectRelay();
      this.latestShips = [];
      this.shipStatus = { code: "ok", message: null };
      this.shipRuntime = "unavailable";
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.shipRuntime = "live";
      this.sendShipSubscribe();
      return;
    }

    if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.shipRuntime = "connecting";
      return;
    }

    this.shipRuntime = "connecting";
    this.connectRelay();
  }

  private connectRelay(): void {
    if (this.disposed || !this.isShipRelayActive() || this.ws) {
      return;
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/traffic`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) {
        return;
      }

      this.reconnectAttempt = 0;
      this.shipRuntime = "live";
      this.sendShipSubscribe();
      this.publishConnectionStatus();
    });

    ws.addEventListener("message", (event) => {
      try {
        const data: unknown = JSON.parse(event.data as string);
        const snapshot = parseSnapshot(data);
        if (!snapshot) {
          return;
        }

        if (this.ws !== ws) {
          return;
        }

        this.latestShips = snapshot.ships;
        this.shipStatus = snapshot.status.ships;
        this.shipRuntime = "live";
        this.publishSnapshot();
        this.publishConnectionStatus();
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      if (this.ws !== ws) {
        return;
      }

      this.ws = null;

      if (!this.disposed && this.isShipRelayActive()) {
        this.shipRuntime = "error";
        this.publishConnectionStatus();
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      // close drives reconnect
    });
  }

  private sendShipSubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const bounds = this.map.getBounds();
    const effectiveLayers = resolveEffectiveTrafficLayers(
      {
        aircraftEnabled: false,
        shipsEnabled: this.state.shipsEnabled
      },
      this.map.getZoom()
    );
    const message: SubscribeMessage = {
      type: "subscribe",
      bbox: bboxFromBounds(bounds),
      zoom: this.map.getZoom(),
      layers: {
        aircraft: false,
        ships: effectiveLayers.shipsEnabled
      }
    };

    this.ws.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.isShipRelayActive() || this.reconnectTimer !== null) {
      return;
    }

    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt), RECONNECT_MAX_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectRelay();
    }, delay);
  }

  private disconnectRelay(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private publishSnapshot(): void {
    const localStatus = resolveLocalTrafficStatus(this.state, this.map.getZoom(), location.hostname);
    const status: SnapshotStatus = {
      aircraft: localStatus.aircraft,
      ships: localStatus.ships.code === "ok" ? this.shipStatus : localStatus.ships
    };

    this.callbacks.onSnapshot({
      type: "snapshot",
      aircraft: this.latestAircraft,
      ships: this.latestShips,
      serverTime: Date.now(),
      status
    });
  }

  private publishConnectionStatus(): void {
    const status = summarizeConnectionStatus(this.aircraftRuntime, this.shipRuntime);
    if (status === this.lastConnectionStatus) {
      return;
    }

    this.lastConnectionStatus = status;
    this.callbacks.onStatusChange(status);
  }

  private isAircraftActive(): boolean {
    return this.state.aircraftEnabled && this.map.getZoom() >= MIN_LIVE_TRAFFIC_ZOOM;
  }

  private isShipRelayActive(): boolean {
    return (
      this.state.shipsEnabled &&
      this.map.getZoom() >= MIN_LIVE_TRAFFIC_ZOOM &&
      !isStaticTrafficHost(location.hostname)
    );
  }
}

function sameBbox(left: Bbox | null, right: Bbox | null): boolean {
  if (!left || !right) {
    return false;
  }

  return left.every((value, index) => Math.abs(value - right[index]) < 0.0001);
}
