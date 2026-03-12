import type { Map } from "maplibre-gl";

import {
  bboxFromBounds,
  debounce,
  getLowZoomTrafficHint,
  parseSnapshot,
  resolveEffectiveTrafficLayers,
  type TrafficToggleState
} from "./trafficHelpers";
import type { SnapshotMessage, SubscribeMessage } from "./trafficTypes";

export type TrafficClientState = TrafficToggleState;

export type TrafficClientCallbacks = {
  onSnapshot: (snapshot: SnapshotMessage) => void;
  onStatusChange: (status: "connecting" | "connected" | "disconnected") => void;
};

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const SUBSCRIBE_DEBOUNCE_MS = 300;

export class TrafficClient {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private map: Map;
  private callbacks: TrafficClientCallbacks;
  readonly state: TrafficClientState;

  /** Debounced version of sendSubscribe bound to moveend. */
  readonly debouncedSubscribe: () => void;

  constructor(map: Map, callbacks: TrafficClientCallbacks) {
    this.map = map;
    this.callbacks = callbacks;
    this.state = { aircraftEnabled: false, shipsEnabled: false };
    this.debouncedSubscribe = debounce(() => this.sendSubscribe(), SUBSCRIBE_DEBOUNCE_MS);
  }

  /** Open the websocket connection and start listening. */
  connect(): void {
    if (this.disposed) return;
    this.callbacks.onStatusChange("connecting");

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/traffic`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.callbacks.onStatusChange("connected");
      this.sendSubscribe();
    });

    ws.addEventListener("message", (event) => {
      try {
        const data: unknown = JSON.parse(event.data as string);
        const snapshot = parseSnapshot(data);
        if (snapshot) {
          this.callbacks.onSnapshot(snapshot);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      if (!this.disposed) {
        this.callbacks.onStatusChange("disconnected");
        this.scheduleReconnect();
      }
    });

    ws.addEventListener("error", () => {
      // error is always followed by close, so reconnect happens there
    });
  }

  /** Send a subscribe message with current viewport and toggle state. */
  sendSubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const bounds = this.map.getBounds();
    const effectiveLayers = resolveEffectiveTrafficLayers(this.state, this.map.getZoom());
    const message: SubscribeMessage = {
      type: "subscribe",
      bbox: bboxFromBounds(bounds),
      zoom: this.map.getZoom(),
      layers: {
        aircraft: effectiveLayers.aircraftEnabled,
        ships: effectiveLayers.shipsEnabled
      }
    };

    this.ws.send(JSON.stringify(message));
  }

  /** Update toggle state and immediately send a new subscription if connected. */
  setLayers(aircraft: boolean, ships: boolean): void {
    this.state.aircraftEnabled = aircraft;
    this.state.shipsEnabled = ships;

    if (!this.ws && (aircraft || ships) && !this.disposed) {
      this.connect();
      return;
    }

    this.sendSubscribe();
  }

  /** Whether the websocket is currently open. */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Tear down the client and stop reconnection. */
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getLowZoomHint(): string | null {
    return getLowZoomTrafficHint(this.state, this.map.getZoom());
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (!this.state.aircraftEnabled && !this.state.shipsEnabled) return;

    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt), RECONNECT_MAX_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
