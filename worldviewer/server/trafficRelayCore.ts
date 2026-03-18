import { bboxArea, bboxUnion, pointInBbox } from "./bbox";
import type {
  Bbox,
  LiveTrack,
  SnapshotMessage,
  SnapshotStatus,
  SubscribeMessage,
  TrafficLayerStatus,
} from "../src/traffic/trafficTypes";

type RelayClientEntry = {
  request: SubscribeMessage | null;
  resolved: ResolvedSubscription | null;
};

export type ResolvedSubscription = {
  request: SubscribeMessage;
  acceptedLayers: SubscribeMessage["layers"];
  status: SnapshotStatus;
};

export type TrafficRelayCoreOptions = {
  maxBboxArea?: number;
  shipStaleMs?: number;
  shipsAvailable?: boolean;
  now?: () => number;
};

export const DEFAULT_MAX_BBOX_AREA = 2500;
export const DEFAULT_SHIP_STALE_MS = 5 * 60_000;

const AIRCRAFT_UNAVAILABLE_MESSAGE =
  "Aircraft traffic is browser-direct; the relay only serves ships.";
const SHIPS_ZOOM_IN_MESSAGE = "Zoom in to request live ships for a smaller area.";
const SHIPS_UNAVAILABLE_MESSAGE = "Ship traffic unavailable: relay is missing AISSTREAM_API_KEY.";

function okStatus(): TrafficLayerStatus {
  return { code: "ok", message: null };
}

function zoomInStatus(message: string): TrafficLayerStatus {
  return { code: "zoom_in", message };
}

function unavailableStatus(message: string): TrafficLayerStatus {
  return { code: "unavailable", message };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function sameBbox(a: Bbox | null, b: Bbox | null): boolean {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function isValidSubscribeMessage(msg: unknown): msg is SubscribeMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const candidate = msg as Record<string, unknown>;
  if (candidate.type !== "subscribe") return false;
  if (!Array.isArray(candidate.bbox) || candidate.bbox.length !== 4) return false;

  const bbox = candidate.bbox;
  if (!bbox.every(isFiniteNumber)) return false;

  const [west, south, east, north] = bbox;
  if (west < -180 || west > 180 || east < -180 || east > 180) return false;
  if (south < -90 || south > 90 || north < -90 || north > 90) return false;
  if (west >= east || south >= north) return false;

  if (candidate.zoom !== undefined && !isFiniteNumber(candidate.zoom)) return false;
  if (typeof candidate.layers !== "object" || candidate.layers === null) return false;

  const layers = candidate.layers as Record<string, unknown>;
  return typeof layers.aircraft === "boolean" && typeof layers.ships === "boolean";
}

export function expireStaleTracks(tracks: Map<string, LiveTrack>, cutoff: number): void {
  for (const [id, track] of tracks) {
    if (track.updatedAt < cutoff) tracks.delete(id);
  }
}

export class TrafficRelayCore<Id> {
  private readonly clients = new Map<Id, RelayClientEntry>();
  private readonly maxBboxArea: number;
  private readonly shipStaleMs: number;
  private readonly shipsAvailable: boolean;
  private readonly now: () => number;

  private readonly shipPositions = new Map<string, LiveTrack>();
  private readonly shipNames = new Map<string, string>();

  constructor(options: TrafficRelayCoreOptions = {}) {
    this.maxBboxArea = options.maxBboxArea ?? DEFAULT_MAX_BBOX_AREA;
    this.shipStaleMs = options.shipStaleMs ?? DEFAULT_SHIP_STALE_MS;
    this.shipsAvailable = options.shipsAvailable ?? false;
    this.now = options.now ?? Date.now;
  }

  addClient(id: Id): void {
    if (!this.clients.has(id)) {
      this.clients.set(id, { request: null, resolved: null });
    }
  }

  removeClient(id: Id): void {
    if (this.clients.delete(id)) {
      this.reconcile();
    }
  }

  clientIds(): IterableIterator<Id> {
    return this.clients.keys();
  }

  getClientCount(): number {
    return this.clients.size;
  }

  setClientSubscription(id: Id, request: SubscribeMessage): void {
    const existing = this.clients.get(id) ?? { request: null, resolved: null };
    existing.request = request;
    this.clients.set(id, existing);
    this.reconcile();
  }

  getClientSnapshot(id: Id): SnapshotMessage | null {
    const resolved = this.clients.get(id)?.resolved;
    if (!resolved) return null;

    this.expireStaleShips();

    const { bbox } = resolved.request;
    const ships = resolved.acceptedLayers.ships
      ? [...this.shipPositions.values()].filter((track) => pointInBbox(track.lng, track.lat, bbox))
      : [];

    return {
      type: "snapshot",
      aircraft: [],
      ships,
      serverTime: this.now(),
      status: resolved.status,
    };
  }

  getActiveShipBbox(): Bbox | null {
    const boxes: Bbox[] = [];
    for (const entry of this.clients.values()) {
      if (entry.resolved?.acceptedLayers.ships) {
        boxes.push(entry.resolved.request.bbox);
      }
    }
    return bboxUnion(boxes);
  }

  hasActiveShipSubscriptions(): boolean {
    return this.getActiveShipBbox() !== null;
  }

  getShipTrackCount(): number {
    return this.shipPositions.size;
  }

  upsertShipTrack(track: LiveTrack): void {
    const cachedName = this.shipNames.get(track.id);
    if (cachedName && !track.label) {
      this.shipPositions.set(track.id, { ...track, label: cachedName });
      return;
    }
    this.shipPositions.set(track.id, track);
  }

  applyShipStatic(info: { mmsi: string; name: string }): void {
    this.shipNames.set(info.mmsi, info.name);
    const existing = this.shipPositions.get(info.mmsi);
    if (existing) {
      this.shipPositions.set(info.mmsi, { ...existing, label: info.name });
    }
  }

  clearShipState(): void {
    this.shipPositions.clear();
    this.shipNames.clear();
  }

  expireStaleShips(now: number = this.now()): void {
    expireStaleTracks(this.shipPositions, now - this.shipStaleMs);
    // Evict cached names for ships whose positions have expired
    for (const mmsi of this.shipNames.keys()) {
      if (!this.shipPositions.has(mmsi)) this.shipNames.delete(mmsi);
    }
  }

  private reconcile(): void {
    const acceptedShipBoxes: Bbox[] = [];

    for (const entry of this.clients.values()) {
      if (!entry.request) {
        entry.resolved = null;
        continue;
      }

      const status: SnapshotStatus = {
        aircraft: entry.request.layers.aircraft
          ? unavailableStatus(AIRCRAFT_UNAVAILABLE_MESSAGE)
          : okStatus(),
        ships:
          entry.request.layers.ships && !this.shipsAvailable
            ? unavailableStatus(SHIPS_UNAVAILABLE_MESSAGE)
            : okStatus(),
      };
      const acceptedLayers = {
        aircraft: false,
        ships: false,
      };

      if (entry.request.layers.ships && this.shipsAvailable) {
        const nextUnion = bboxUnion([...acceptedShipBoxes, entry.request.bbox]);
        if (nextUnion !== null && bboxArea(nextUnion) <= this.maxBboxArea) {
          acceptedLayers.ships = true;
          acceptedShipBoxes.push(entry.request.bbox);
        } else {
          status.ships = zoomInStatus(SHIPS_ZOOM_IN_MESSAGE);
        }
      }

      entry.resolved = {
        request: entry.request,
        acceptedLayers,
        status,
      };
    }

    if (!this.hasActiveShipSubscriptions()) {
      this.clearShipState();
    }
  }
}
