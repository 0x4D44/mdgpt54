import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { parsePositionReport, parseShipStaticData, bboxToAISStreamSubscription } from "./providers/aisstream";
import { openSkyUrl, parseOpenSkyStates } from "./providers/opensky";
import { TrafficRelayCore, DEFAULT_MAX_BBOX_AREA, DEFAULT_MIN_OPENSKY_POLL_MS, DEFAULT_SHIP_STALE_MS, isValidSubscribeMessage, sameBbox } from "./trafficRelayCore";
import type { Bbox } from "./trafficModel";

const PORT = parseInt(process.env.TRAFFIC_PORT ?? "3210", 10);
const OPENSKY_POLL_MS = 15_000;
const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;

const relay = new TrafficRelayCore<WebSocket>({
  maxBboxArea: DEFAULT_MAX_BBOX_AREA,
  shipStaleMs: DEFAULT_SHIP_STALE_MS,
  minOpenSkyPollMs: DEFAULT_MIN_OPENSKY_POLL_MS,
  shipsAvailable: Boolean(AISSTREAM_API_KEY),
});

let aircraftPollTimer: ReturnType<typeof setTimeout> | null = null;
let aisSocket: WebSocket | null = null;
let aisReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let aisSubscribedBbox: Bbox | null = null;

async function pollOpenSky(): Promise<void> {
  const bbox = relay.getActiveAircraftBbox();
  if (!bbox) {
    relay.clearAircraftTracks();
    return;
  }

  relay.markOpenSkyPoll();

  try {
    const res = await fetch(openSkyUrl(bbox));
    if (!res.ok) {
      console.warn(`[opensky] HTTP ${res.status}`);
      return;
    }

    const data = await res.json();
    const tracks = parseOpenSkyStates(data);
    relay.setAircraftTracks(tracks);
    console.log(`[opensky] ${tracks.length} aircraft`);
  } catch (err) {
    console.warn("[opensky] poll error:", err);
  }
}

function scheduleAircraftPoll(delayMs: number): void {
  if (aircraftPollTimer) return;

  aircraftPollTimer = setTimeout(async () => {
    aircraftPollTimer = null;
    await pollOpenSky();
    broadcastSnapshots();

    if (relay.hasActiveAircraftSubscriptions()) {
      scheduleAircraftPoll(OPENSKY_POLL_MS);
    }
  }, delayMs);
}

function ensureAircraftPoller(): void {
  const delay = relay.getNextOpenSkyPollDelay();
  if (delay === null) {
    stopAircraftPoller();
    relay.clearAircraftTracks();
    return;
  }

  scheduleAircraftPoll(delay);
}

function stopAircraftPoller(): void {
  if (aircraftPollTimer) {
    clearTimeout(aircraftPollTimer);
    aircraftPollTimer = null;
  }
}

function connectAISStream(shouldResubscribe: boolean): void {
  const bbox = relay.getActiveShipBbox();
  if (!AISSTREAM_API_KEY || !bbox) return;

  if (aisSocket?.readyState === WebSocket.OPEN) {
    if (!shouldResubscribe || sameBbox(aisSubscribedBbox, bbox)) return;
    aisSocket.send(JSON.stringify(bboxToAISStreamSubscription(bbox, AISSTREAM_API_KEY)));
    aisSubscribedBbox = bbox;
    console.log("[aisstream] resubscribed with updated bbox");
    return;
  }

  if (aisSocket) return;

  console.log("[aisstream] connecting...");
  aisSocket = new WebSocket(AISSTREAM_URL);

  aisSocket.on("open", () => {
    console.log("[aisstream] connected");
    const currentBbox = relay.getActiveShipBbox();
    if (!currentBbox || !AISSTREAM_API_KEY) return;

    aisSocket?.send(JSON.stringify(bboxToAISStreamSubscription(currentBbox, AISSTREAM_API_KEY)));
    aisSubscribedBbox = currentBbox;
  });

  aisSocket.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.MessageType === "PositionReport") {
        const track = parsePositionReport(msg);
        if (track) {
          relay.upsertShipTrack(track);
        }
      } else if (msg.MessageType === "ShipStaticData") {
        const info = parseShipStaticData(msg);
        if (info) {
          relay.applyShipStatic(info);
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  aisSocket.on("close", () => {
    console.log("[aisstream] disconnected");
    aisSocket = null;
    aisSubscribedBbox = null;
    scheduleAISReconnect();
  });

  aisSocket.on("error", (err) => {
    console.warn("[aisstream] error:", err);
    aisSocket?.close();
  });
}

function scheduleAISReconnect(): void {
  if (aisReconnectTimer) return;
  if (!relay.getActiveShipBbox() || !AISSTREAM_API_KEY) return;

  aisReconnectTimer = setTimeout(() => {
    aisReconnectTimer = null;
    connectAISStream(true);
  }, 5_000);
}

function disconnectAISStream(): void {
  if (aisReconnectTimer) {
    clearTimeout(aisReconnectTimer);
    aisReconnectTimer = null;
  }
  if (aisSocket) {
    aisSocket.close();
    aisSocket = null;
  }
  aisSubscribedBbox = null;
}

function broadcastSnapshots(): void {
  for (const ws of relay.clientIds()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const snapshot = relay.getClientSnapshot(ws);
    if (snapshot) {
      ws.send(JSON.stringify(snapshot));
    }
  }
}

function syncUpstreams(previousShipBbox: Bbox | null): void {
  if (relay.hasActiveAircraftSubscriptions()) {
    ensureAircraftPoller();
  } else {
    stopAircraftPoller();
    relay.clearAircraftTracks();
  }

  const nextShipBbox = relay.getActiveShipBbox();
  if (nextShipBbox) {
    connectAISStream(!sameBbox(previousShipBbox, nextShipBbox));
  } else {
    disconnectAISStream();
    relay.clearShipState();
  }
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("worldviewer traffic relay");
});

const wss = new WebSocketServer({ server: httpServer, path: "/traffic" });

wss.on("connection", (ws) => {
  relay.addClient(ws);
  console.log(`[relay] client connected (${relay.getClientCount()} total)`);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (!isValidSubscribeMessage(msg)) return;

      const previousShipBbox = relay.getActiveShipBbox();
      relay.setClientSubscription(ws, msg);
      syncUpstreams(previousShipBbox);
      broadcastSnapshots();
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    const previousShipBbox = relay.getActiveShipBbox();
    relay.removeClient(ws);
    console.log(`[relay] client disconnected (${relay.getClientCount()} total)`);
    syncUpstreams(previousShipBbox);
    broadcastSnapshots();
  });
});

httpServer.listen(PORT, () => {
  console.log(`[relay] listening on http://localhost:${PORT}/traffic`);
});

setInterval(() => {
  if (relay.hasActiveShipSubscriptions() || relay.getShipTrackCount() > 0) {
    broadcastSnapshots();
  }
}, 5_000);
