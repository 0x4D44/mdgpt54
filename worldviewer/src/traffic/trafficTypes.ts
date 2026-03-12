/** Canonical bounding box: [west, south, east, north] in WGS84 decimal degrees. */
export type Bbox = [west: number, south: number, east: number, north: number];

export type LiveTrackKind = "aircraft" | "ship";

export type LiveTrack = {
  id: string;
  kind: LiveTrackKind;
  lng: number;
  lat: number;
  heading: number | null;
  speedKnots: number | null;
  altitudeMeters: number | null;
  label: string | null;
  source: "opensky" | "aisstream";
  updatedAt: number;
  callsign?: string | null;
  flightCode?: string | null;
  aircraftCategory?: number | null;
  geoAltitudeMeters?: number | null;
  aircraftTypeCode?: string | null;
  registration?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  renderModelKey?: string | null;
};

export type TrafficLayerStatusCode = "ok" | "zoom_in" | "unavailable";

export type TrafficLayerStatus = {
  code: TrafficLayerStatusCode;
  message: string | null;
};

export type TrafficConnectionStatus =
  | "standby"
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable";

export type SnapshotStatus = {
  aircraft: TrafficLayerStatus;
  ships: TrafficLayerStatus;
};

/** Browser to relay */
export type SubscribeMessage = {
  type: "subscribe";
  bbox: Bbox;
  zoom?: number;
  layers: {
    aircraft: boolean;
    ships: boolean;
  };
};

/** Relay to browser */
export type SnapshotMessage = {
  type: "snapshot";
  aircraft: LiveTrack[];
  ships: LiveTrack[];
  serverTime: number;
  status: SnapshotStatus;
};
