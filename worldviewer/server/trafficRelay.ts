import { createServer } from "http";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { parsePositionReport, parseShipStaticData, bboxToAISStreamSubscription } from "./providers/aisstream";
import { createRelayLogger } from "./relayLogger";
import {
  TrafficRelayCore,
  DEFAULT_MAX_BBOX_AREA,
  DEFAULT_SHIP_STALE_MS,
  isValidSubscribeMessage,
  sameBbox,
} from "./trafficRelayCore";
import type { Bbox } from "../src/traffic/trafficTypes";

const PORT = parseInt(process.env.TRAFFIC_PORT ?? "3210", 10);
const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY ?? null;
const AISSTREAM_RECONNECT_MS = 5_000;
const SNAPSHOT_HEARTBEAT_MS = 5_000;
const SOCKET_OPEN = 1;

type SocketListener = (...args: unknown[]) => void;

export type RelayClientSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "message" | "close", listener: SocketListener): void;
};

export type ShipFeedSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open" | "message" | "close" | "error", listener: SocketListener): void;
};

export type TrafficRelayAppOptions = {
  relay?: TrafficRelayCore<RelayClientSocket>;
  shipsApiKey?: string | null;
  shipFeedUrl?: string;
  createShipSocket?: (url: string) => ShipFeedSocket;
  log?: Pick<Console, "log" | "warn" | "debug">;
};

export type HealthStatus = {
  clients: number;
  activeShipBbox: Bbox | null;
  shipTracks: number;
  uptime: number;
  memoryMB: number;
};

export type TrafficRelayApp = {
  handleClientConnection(client: RelayClientSocket): void;
  broadcastSnapshots(): void;
  shouldBroadcastSnapshots(): boolean;
  getHealthStatus(): HealthStatus;
  dispose(): void;
};

type TrafficRelayServer = {
  app: TrafficRelayApp;
  httpServer: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  close(): Promise<void>;
};

export function createTrafficRelayApp(options: TrafficRelayAppOptions = {}): TrafficRelayApp {
  const shipsApiKey = options.shipsApiKey ?? AISSTREAM_API_KEY;
  const shipFeedUrl = options.shipFeedUrl ?? AISSTREAM_URL;
  const createShipSocket = options.createShipSocket ?? ((url: string) => new WebSocket(url));
  const log = options.log ?? createRelayLogger();
  const relay =
    options.relay ??
    new TrafficRelayCore<RelayClientSocket>({
      maxBboxArea: DEFAULT_MAX_BBOX_AREA,
      shipStaleMs: DEFAULT_SHIP_STALE_MS,
      shipsAvailable: Boolean(shipsApiKey),
    });

  let shipSocket: ShipFeedSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let subscribedBbox: Bbox | null = null;

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function broadcastSnapshots(): void {
    for (const client of relay.clientIds()) {
      if (client.readyState !== SOCKET_OPEN) continue;
      const snapshot = relay.getClientSnapshot(client);
      if (snapshot) {
        client.send(JSON.stringify(snapshot));
      }
    }
  }

  function shouldBroadcastSnapshots(): boolean {
    return relay.hasActiveShipSubscriptions() || relay.getShipTrackCount() > 0;
  }

  function handleShipFeedMessage(raw: unknown): void {
    try {
      const message = JSON.parse(String(raw));
      if (message.MessageType === "PositionReport") {
        const track = parsePositionReport(message);
        if (track) {
          relay.upsertShipTrack(track);
          broadcastSnapshots();
        }
        return;
      }

      if (message.MessageType === "ShipStaticData") {
        const info = parseShipStaticData(message);
        if (info) {
          relay.applyShipStatic(info);
          broadcastSnapshots();
        }
      }
    } catch (error) {
      log.debug("[aisstream] failed to parse ship feed message:", error);
    }
  }

  function scheduleShipReconnect(): void {
    if (reconnectTimer || !shipsApiKey || !relay.getActiveShipBbox()) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectShipFeed(true);
    }, AISSTREAM_RECONNECT_MS);
  }

  function disconnectShipFeed(): void {
    clearReconnectTimer();
    const activeShipSocket = shipSocket;
    shipSocket = null;
    subscribedBbox = null;
    activeShipSocket?.close();
  }

  function connectShipFeed(shouldResubscribe: boolean): void {
    const bbox = relay.getActiveShipBbox();
    if (!shipsApiKey || !bbox) return;

    if (shipSocket?.readyState === SOCKET_OPEN) {
      if (!shouldResubscribe || sameBbox(subscribedBbox, bbox)) return;
      shipSocket.send(JSON.stringify(bboxToAISStreamSubscription(bbox, shipsApiKey)));
      subscribedBbox = bbox;
      log.log("[aisstream] resubscribed with updated bbox");
      return;
    }

    if (shipSocket) return;

    log.log("[aisstream] connecting...");
    const nextShipSocket = createShipSocket(shipFeedUrl);
    shipSocket = nextShipSocket;

    nextShipSocket.on("open", () => {
      if (shipSocket !== nextShipSocket) return;

      log.log("[aisstream] connected");
      const currentBbox = relay.getActiveShipBbox();
      if (!currentBbox || !shipsApiKey) return;

      nextShipSocket.send(JSON.stringify(bboxToAISStreamSubscription(currentBbox, shipsApiKey)));
      subscribedBbox = currentBbox;
    });

    nextShipSocket.on("message", (raw) => {
      if (shipSocket !== nextShipSocket) return;
      handleShipFeedMessage(raw);
    });

    nextShipSocket.on("close", () => {
      if (shipSocket !== nextShipSocket) return;

      log.log("[aisstream] disconnected");
      shipSocket = null;
      subscribedBbox = null;
      scheduleShipReconnect();
    });

    nextShipSocket.on("error", (error) => {
      if (shipSocket !== nextShipSocket) return;
      log.warn("[aisstream] error:", error);
      nextShipSocket.close();
    });
  }

  function syncShipFeed(previousShipBbox: Bbox | null): void {
    const nextShipBbox = relay.getActiveShipBbox();
    if (nextShipBbox) {
      connectShipFeed(!sameBbox(previousShipBbox, nextShipBbox));
      return;
    }

    disconnectShipFeed();
    relay.clearShipState();
  }

  function handleClientConnection(client: RelayClientSocket): void {
    relay.addClient(client);
    log.log(`[relay] client connected (${relay.getClientCount()} total)`);

    client.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (!isValidSubscribeMessage(message)) return;

        const previousShipBbox = relay.getActiveShipBbox();
        relay.setClientSubscription(client, message);
        syncShipFeed(previousShipBbox);
        broadcastSnapshots();
      } catch (error) {
        log.debug("[relay] failed to parse client message:", error);
      }
    });

    client.on("close", () => {
      const previousShipBbox = relay.getActiveShipBbox();
      relay.removeClient(client);
      log.log(`[relay] client disconnected (${relay.getClientCount()} total)`);
      syncShipFeed(previousShipBbox);
      broadcastSnapshots();
    });
  }

  function dispose(): void {
    disconnectShipFeed();
    for (const client of Array.from(relay.clientIds())) {
      relay.removeClient(client);
    }
  }

  function getHealthStatus(): HealthStatus {
    return {
      clients: relay.getClientCount(),
      activeShipBbox: relay.getActiveShipBbox(),
      shipTracks: relay.getShipTrackCount(),
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024 * 10) / 10,
    };
  }

  return {
    handleClientConnection,
    broadcastSnapshots,
    shouldBroadcastSnapshots,
    getHealthStatus,
    dispose,
  };
}

export function startTrafficRelayServer(
  port: number = PORT,
  options: TrafficRelayAppOptions = {},
): TrafficRelayServer {
  const app = createTrafficRelayApp(options);
  const log = options.log ?? createRelayLogger();
  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body = JSON.stringify(app.getHealthStatus());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("worldviewer traffic relay");
  });
  const wss = new WebSocketServer({ server: httpServer, path: "/traffic" });
  const heartbeatTimer = setInterval(() => {
    if (app.shouldBroadcastSnapshots()) {
      app.broadcastSnapshots();
    }
  }, SNAPSHOT_HEARTBEAT_MS);

  wss.on("connection", (client) => {
    app.handleClientConnection(client);
  });

  httpServer.listen(port, () => {
    log.log(`[relay] listening on http://localhost:${port}/traffic`);
  });

  return {
    app,
    httpServer,
    wss,
    async close(): Promise<void> {
      clearInterval(heartbeatTimer);
      app.dispose();
      const websocketServerClosed = new Promise<void>((resolveClose) => wss.close(() => resolveClose()));
      for (const client of wss.clients) {
        client.terminate();
      }
      await websocketServerClosed;
      await new Promise<void>((resolveClose, rejectClose) =>
        httpServer.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    },
  };
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  return fileURLToPath(import.meta.url) === resolve(entryPath);
}

if (isDirectExecution()) {
  startTrafficRelayServer();
}
