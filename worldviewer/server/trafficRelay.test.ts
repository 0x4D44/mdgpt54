import { once } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket as RealWebSocket } from "ws";

import { createTrafficRelayApp, startTrafficRelayServer } from "./trafficRelay";
import type { Bbox, SnapshotMessage } from "../src/traffic/trafficTypes";

type SocketListener = (...args: unknown[]) => void;

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sentMessages: string[] = [];
  closeCalls = 0;
  private readonly listeners = new Map<string, SocketListener[]>();

  on(event: string, listener: SocketListener): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = FakeSocket.CLOSED;
  }

  emit(event: string, ...args: unknown[]): void {
    if (event === "open") {
      this.readyState = FakeSocket.OPEN;
    }
    if (event === "close") {
      this.readyState = FakeSocket.CLOSED;
    }

    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

class FakeClientSocket extends FakeSocket {
  constructor() {
    super();
    this.readyState = FakeSocket.OPEN;
  }
}

class FakeShipSocket extends FakeSocket {}

const quietLog = {
  log: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
};

function subscribe(bbox: Bbox, aircraft: boolean, ships: boolean): string {
  return JSON.stringify({
    type: "subscribe",
    bbox,
    layers: {
      aircraft,
      ships,
    },
  });
}

function latestSnapshot(client: FakeClientSocket): SnapshotMessage {
  const raw = client.sentMessages.at(-1);
  if (!raw) {
    throw new Error("Expected the client to receive a snapshot.");
  }
  return JSON.parse(raw) as SnapshotMessage;
}

function positionReport(mmsi = "211234567", shipName = "BLUE HORIZON"): string {
  return JSON.stringify({
    MessageType: "PositionReport",
    MetaData: {
      MMSI: mmsi,
      ShipName: shipName,
    },
    Message: {
      PositionReport: {
        Longitude: -3.3,
        Latitude: 55.9,
        TrueHeading: 120,
        Sog: 12.5,
        Cog: 118.3,
      },
    },
  });
}

const EDINBURGH_BOX: Bbox = [-3.6, 55.8, -3.0, 56.1];

function withTimeout<T>(promise: Promise<T>, delayMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), delayMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe("createTrafficRelayApp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps aircraft-only subscriptions off the ship relay upstream", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe([0, 0, 1, 1], true, false));

    expect(shipSockets).toHaveLength(0);
    expect(latestSnapshot(client).status.aircraft.code).toBe("unavailable");

    app.dispose();
  });

  it("resubscribes the live ship feed when the accepted bbox changes", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe([0, 0, 1, 1], false, true));

    expect(shipSockets).toHaveLength(1);

    const shipSocket = shipSockets[0];
    shipSocket.emit("open");
    client.emit("message", subscribe([2, 2, 3, 3], false, true));

    expect(shipSockets).toHaveLength(1);
    expect(shipSocket.sentMessages).toHaveLength(2);
    expect(JSON.parse(shipSocket.sentMessages[0])).toMatchObject({
      APIKey: "test-key",
      BoundingBoxes: [[[0, 0], [1, 1]]],
    });
    expect(JSON.parse(shipSocket.sentMessages[1])).toMatchObject({
      APIKey: "test-key",
      BoundingBoxes: [[[2, 2], [3, 3]]],
    });

    app.dispose();
  });

  it("cancels a scheduled ship-feed reconnect when the last subscriber leaves", () => {
    vi.useFakeTimers();

    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe([0, 0, 1, 1], false, true));

    shipSockets[0].emit("close");
    client.emit("close");
    vi.advanceTimersByTime(5_000);

    expect(shipSockets).toHaveLength(1);

    app.dispose();
  });

  it("clears ship state when the relay lifecycle restarts from zero subscribers", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const firstClient = new FakeClientSocket();

    app.handleClientConnection(firstClient);
    firstClient.emit("message", subscribe(EDINBURGH_BOX, false, true));

    shipSockets[0].emit("open");
    shipSockets[0].emit("message", positionReport());

    expect(latestSnapshot(firstClient).ships).toHaveLength(1);

    firstClient.emit("close");

    const secondClient = new FakeClientSocket();
    app.handleClientConnection(secondClient);
    secondClient.emit("message", subscribe(EDINBURGH_BOX, false, true));

    expect(latestSnapshot(secondClient).ships).toEqual([]);

    app.dispose();
  });

  it("ignores malformed JSON from the ship feed", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));
    shipSockets[0].emit("open");

    // Should not throw
    shipSockets[0].emit("message", "not-json{{{");

    app.dispose();
  });

  it("handles ShipStaticData messages from the ship feed", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));
    shipSockets[0].emit("open");

    // First send a position report
    shipSockets[0].emit("message", positionReport("211234567", ""));
    // Then send static data with a name
    const staticData = JSON.stringify({
      MessageType: "ShipStaticData",
      MetaData: { MMSI: "211234567", ShipName: "BLUE HORIZON" },
      Message: { ShipStaticData: { Name: "BLUE HORIZON" } },
    });
    shipSockets[0].emit("message", staticData);

    const snap = latestSnapshot(client);
    const ship = snap.ships.find((s) => s.id === "211234567");
    expect(ship?.label).toBe("BLUE HORIZON");

    app.dispose();
  });

  it("does not connect ship feed when no API key is configured", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: null,
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    expect(shipSockets).toHaveLength(0);

    app.dispose();
  });

  it("ignores ship feed open callback when the socket has been replaced", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    const firstSocket = shipSockets[0];

    // Simulate the first socket getting closed and a reconnect creating a new one
    firstSocket.emit("close");
    // Client still connected, so after close the reconnect timer is set
    // Force a new subscription to trigger a new socket
    client.emit("message", subscribe([-4, 55, -2, 57], false, true));

    // The "open" event on the stale first socket should be ignored
    firstSocket.emit("open");
    expect(firstSocket.sentMessages).toHaveLength(0);

    app.dispose();
  });

  it("ignores ship feed message callback when the socket has been replaced", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    const firstSocket = shipSockets[0];
    firstSocket.emit("open");

    // Simulate close and reconnect
    firstSocket.emit("close");
    client.emit("message", subscribe([-4, 55, -2, 57], false, true));

    // Messages arriving on the stale socket should be ignored
    const messageCountBefore = client.sentMessages.length;
    firstSocket.emit("message", positionReport());
    expect(client.sentMessages.length).toBe(messageCountBefore);

    app.dispose();
  });

  it("logs and closes the ship socket on error", () => {
    const warnings: unknown[] = [];
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: {
        log: () => undefined,
        warn: (...args: unknown[]) => warnings.push(args),
        debug: () => undefined,
      },
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    const shipSocket = shipSockets[0];
    shipSocket.emit("error", new Error("test error"));

    expect(shipSocket.closeCalls).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);

    app.dispose();
  });

  it("ignores error callback on a stale ship socket", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    const firstSocket = shipSockets[0];
    firstSocket.emit("close");

    // Trigger a new socket
    client.emit("message", subscribe([-4, 55, -2, 57], false, true));

    // Error on the stale socket should be ignored (not closing the new socket)
    const closeCountBefore = firstSocket.closeCalls;
    firstSocket.emit("error", new Error("stale error"));
    // The stale socket close count should not change from the error handler
    // because the guard `shipSocket !== nextShipSocket` will return early
    expect(firstSocket.closeCalls).toBe(closeCountBefore);

    app.dispose();
  });

  it("ignores close callback on a stale ship socket", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    const firstSocket = shipSockets[0];
    firstSocket.emit("close");

    // Trigger a new socket
    client.emit("message", subscribe([-4, 55, -2, 57], false, true));
    const secondSocket = shipSockets[1];

    // Stale close should not null out the current shipSocket or schedule reconnect
    firstSocket.emit("close");

    // The second socket should still be operational
    secondSocket.emit("open");
    expect(secondSocket.sentMessages.length).toBeGreaterThan(0);

    app.dispose();
  });

  it("schedules a reconnect when the ship feed closes and there are still subscribers", () => {
    vi.useFakeTimers();

    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    expect(shipSockets).toHaveLength(1);
    shipSockets[0].emit("close");

    // After the reconnect delay, a new socket should be created
    vi.advanceTimersByTime(5_000);
    expect(shipSockets).toHaveLength(2);

    app.dispose();
  });

  it("does not reconnect when there is no active ship bbox after close", () => {
    vi.useFakeTimers();

    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    // Remove the client before the socket closes
    client.emit("close");
    shipSockets[0].emit("close");

    vi.advanceTimersByTime(10_000);
    expect(shipSockets).toHaveLength(1);

    app.dispose();
  });

  it("ignores malformed JSON from a client message", () => {
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => new FakeShipSocket(),
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    // Should not throw
    client.emit("message", "{invalid json");

    app.dispose();
  });

  it("ignores a well-formed JSON message that is not a valid subscribe message", () => {
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => new FakeShipSocket(),
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", JSON.stringify({ type: "ping" }));

    // No snapshot should be sent for an invalid subscribe message
    expect(client.sentMessages).toHaveLength(0);

    app.dispose();
  });

  it("skips broadcast to a client whose readyState is not OPEN", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    // Close the client socket (makes readyState = CLOSED)
    client.readyState = FakeSocket.CLOSED;

    const messageCountBefore = client.sentMessages.length;
    app.broadcastSnapshots();
    expect(client.sentMessages.length).toBe(messageCountBefore);

    app.dispose();
  });

  it("shouldBroadcastSnapshots returns true when there are active ship subscriptions", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    expect(app.shouldBroadcastSnapshots()).toBe(false);

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    expect(app.shouldBroadcastSnapshots()).toBe(true);

    app.dispose();
  });

  it("does not create a second ship socket while one is already connecting", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    expect(shipSockets).toHaveLength(1);

    // A second subscribe while the socket is still CONNECTING should not create another
    client.emit("message", subscribe([-4, 55, -2, 57], false, true));

    expect(shipSockets).toHaveLength(1);

    app.dispose();
  });

  it("does not resubscribe when the bbox has not changed", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));
    shipSockets[0].emit("open");

    const sentCountAfterOpen = shipSockets[0].sentMessages.length;

    // Same bbox again — should not re-send the subscription
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    expect(shipSockets[0].sentMessages.length).toBe(sentCountAfterOpen);

    app.dispose();
  });

  it("does not send a subscription on open when there is no active bbox", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));

    const shipSocket = shipSockets[0];

    // Client disconnects before the ship feed opens
    client.emit("close");

    // When the socket opens, there should be no active bbox to subscribe to
    shipSocket.emit("open");
    expect(shipSocket.sentMessages).toHaveLength(0);

    app.dispose();
  });

  it("dispose closes the ship socket and removes all clients", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));
    shipSockets[0].emit("open");

    app.dispose();

    expect(shipSockets[0].closeCalls).toBeGreaterThan(0);
  });

  it("handles a position report with null parse result gracefully", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));
    shipSockets[0].emit("open");

    const sentCountBefore = client.sentMessages.length;

    // A PositionReport that parsePositionReport returns null for (invalid coords)
    const invalidReport = JSON.stringify({
      MessageType: "PositionReport",
      MetaData: { MMSI: "123" },
      Message: {
        PositionReport: {
          Longitude: 999,
          Latitude: 999,
          TrueHeading: 0,
          Sog: 0,
          Cog: 0,
        },
      },
    });
    shipSockets[0].emit("message", invalidReport);

    // No new snapshot should be sent since the report was invalid
    expect(client.sentMessages.length).toBe(sentCountBefore);

    app.dispose();
  });

  it("handles ShipStaticData with null parse result gracefully", () => {
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));
    shipSockets[0].emit("open");

    const sentCountBefore = client.sentMessages.length;

    // ShipStaticData message with missing data that makes parseShipStaticData return null
    const invalidStatic = JSON.stringify({
      MessageType: "ShipStaticData",
      MetaData: {},
      Message: {},
    });
    shipSockets[0].emit("message", invalidStatic);

    // No new snapshot should be sent
    expect(client.sentMessages.length).toBe(sentCountBefore);

    app.dispose();
  });

  it("calls log.debug when the ship feed sends malformed JSON", () => {
    const debugCalls: unknown[][] = [];
    const shipSockets: FakeShipSocket[] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: {
        log: () => undefined,
        warn: () => undefined,
        debug: (...args: unknown[]) => debugCalls.push(args),
      },
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", subscribe(EDINBURGH_BOX, false, true));
    shipSockets[0].emit("open");

    shipSockets[0].emit("message", "not-json{{{");

    expect(debugCalls.length).toBe(1);
    expect(debugCalls[0][0]).toContain("failed to parse");

    app.dispose();
  });

  it("calls log.debug when a client sends malformed JSON", () => {
    const debugCalls: unknown[][] = [];
    const app = createTrafficRelayApp({
      shipsApiKey: "test-key",
      createShipSocket: () => new FakeShipSocket(),
      log: {
        log: () => undefined,
        warn: () => undefined,
        debug: (...args: unknown[]) => debugCalls.push(args),
      },
    });
    const client = new FakeClientSocket();

    app.handleClientConnection(client);
    client.emit("message", "{invalid json");

    expect(debugCalls.length).toBe(1);
    expect(debugCalls[0][0]).toContain("failed to parse");

    app.dispose();
  });
});

describe("startTrafficRelayServer", () => {
  it("closes connected websocket clients during shutdown", async () => {
    const server = startTrafficRelayServer(0, {
      shipsApiKey: null,
      log: quietLog,
    });

    try {
      if (!server.httpServer.listening) {
        await once(server.httpServer, "listening");
      }

      const address = server.httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the relay server to listen on a TCP port.");
      }

      const client = new RealWebSocket(`ws://127.0.0.1:${address.port}/traffic`);
      try {
        await withTimeout(once(client, "open"), 1_000, "Expected client to connect.");
        const clientClosed = withTimeout(
          once(client, "close"),
          1_000,
          "Expected client to close during shutdown.",
        );

        await withTimeout(
          server.close(),
          1_000,
          "Expected relay shutdown to resolve with a connected client.",
        );
        await clientClosed;
      } finally {
        if (client.readyState === RealWebSocket.CONNECTING || client.readyState === RealWebSocket.OPEN) {
          client.terminate();
        }
      }
    } finally {
      if (server.httpServer.listening) {
        await server.close();
      }
    }
  });

  it("responds to HTTP requests with a plain text health message", async () => {
    const server = startTrafficRelayServer(0, {
      shipsApiKey: null,
      log: quietLog,
    });

    try {
      if (!server.httpServer.listening) {
        await once(server.httpServer, "listening");
      }

      const address = server.httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the relay server to listen on a TCP port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toBe("worldviewer traffic relay");
    } finally {
      await server.close();
    }
  });

  it("runs the heartbeat timer to broadcast snapshots", async () => {
    vi.useFakeTimers();

    const shipSockets: FakeShipSocket[] = [];
    const server = startTrafficRelayServer(0, {
      shipsApiKey: "test-key",
      createShipSocket: () => {
        const socket = new FakeShipSocket();
        shipSockets.push(socket);
        return socket;
      },
      log: quietLog,
    });

    try {
      // Simulate a client connecting via handleClientConnection directly
      const client = new FakeClientSocket();
      server.app.handleClientConnection(client);
      client.emit("message", subscribe(EDINBURGH_BOX, false, true));

      // The heartbeat should trigger broadcastSnapshots
      const sentCountBefore = client.sentMessages.length;
      vi.advanceTimersByTime(5_000);
      expect(client.sentMessages.length).toBeGreaterThan(sentCountBefore);
    } finally {
      vi.useRealTimers();
      await server.close();
    }
  });
});
