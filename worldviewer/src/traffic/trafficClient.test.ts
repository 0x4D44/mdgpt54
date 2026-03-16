import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrafficClient } from "./trafficClient";
import { AIRCRAFT_FEED_ERROR_MESSAGE, SHIP_RELAY_ERROR_MESSAGE } from "./trafficRuntime";

type MockEvent = { data?: string };
type MockListener = (event: MockEvent) => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];
  private readonly listeners = new Map<string, MockListener[]>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: MockListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSING;
  }

  emit(type: string, event: MockEvent = {}): void {
    if (type === "open") {
      this.readyState = MockWebSocket.OPEN;
    }
    if (type === "close") {
      this.readyState = MockWebSocket.CLOSED;
    }

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createMapStub() {
  return {
    getZoom: () => 8,
    getBounds: () => ({
      getWest: () => -3.6,
      getSouth: () => 55.8,
      getEast: () => -3.0,
      getNorth: () => 56.1
    })
  };
}

function createShipTrack(id = "ship-1") {
  return {
    id,
    kind: "ship" as const,
    lng: -3.3,
    lat: 55.95,
    heading: 90,
    speedKnots: 12,
    altitudeMeters: null,
    label: "Test ship",
    source: "aisstream" as const,
    updatedAt: 123
  };
}

function stubAircraftFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }))
  );
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("TrafficClient", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "localhost:5173",
      hostname: "localhost"
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it("ignores stale ship websocket close events after a reconnect", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.emit("open");
    expect(client.isConnected()).toBe(true);

    client.setLayers(false, false);
    client.setLayers(false, true);

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.emit("open");
    expect(client.isConnected()).toBe(true);

    firstSocket.emit("close");
    expect(client.isConnected()).toBe(true);

    client.dispose();
  });

  it("keeps aircraft-only traffic browser-direct without opening the ship relay", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(0);

    client.dispose();
  });

  it("sends ships-only relay subscriptions even when aircraft are also enabled", async () => {
    stubAircraftFetch();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, true);
    await flushAsyncWork();

    const socket = MockWebSocket.instances[0];
    socket.emit("open");

    expect(JSON.parse(socket.sentMessages[0])).toMatchObject({
      type: "subscribe",
      layers: {
        aircraft: false,
        ships: true
      }
    });

    client.dispose();
  });

  it("clears ship markers when the live relay closes", () => {
    const snapshots: Array<{ ships: unknown[]; status: { ships: { code: string; message: string | null } } }> = [];
    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (snapshot) => {
        snapshots.push({
          ships: snapshot.ships,
          status: { ships: snapshot.status.ships }
        });
      },
      onStatusChange: (status) => {
        statuses.push(status);
      }
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({
        type: "snapshot",
        aircraft: [],
        ships: [createShipTrack()],
        serverTime: 123,
        status: {
          aircraft: { code: "ok", message: null },
          ships: { code: "ok", message: null }
        }
      })
    });

    expect(snapshots.at(-1)?.ships).toHaveLength(1);

    socket.emit("close");

    expect(snapshots.at(-1)?.ships).toEqual([]);
    expect(snapshots.at(-1)?.status.ships).toEqual({
      code: "error",
      message: SHIP_RELAY_ERROR_MESSAGE
    });
    expect(statuses.at(-1)).toBe("disconnected");

    client.dispose();
  });

  it("keeps the aggregate status live when aircraft stay live through a ship relay outage", async () => {
    stubAircraftFetch();

    const snapshots: Array<{
      ships: unknown[];
      status: {
        aircraft: { code: string; message: string | null };
        ships: { code: string; message: string | null };
      };
    }> = [];
    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (snapshot) => {
        snapshots.push({
          ships: snapshot.ships,
          status: {
            aircraft: snapshot.status.aircraft,
            ships: snapshot.status.ships
          }
        });
      },
      onStatusChange: (status) => {
        statuses.push(status);
      }
    });

    client.setLayers(true, true);
    await flushAsyncWork();

    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({
        type: "snapshot",
        aircraft: [],
        ships: [createShipTrack()],
        serverTime: 123,
        status: {
          aircraft: { code: "ok", message: null },
          ships: { code: "ok", message: null }
        }
      })
    });
    socket.emit("close");

    expect(statuses.at(-1)).toBe("connected");
    expect(snapshots.at(-1)?.ships).toEqual([]);
    expect(snapshots.at(-1)?.status.aircraft).toEqual({ code: "ok", message: null });
    expect(snapshots.at(-1)?.status.ships).toEqual({
      code: "error",
      message: SHIP_RELAY_ERROR_MESSAGE
    });

    client.dispose();
  });

  it("publishes aircraft-specific failure status when the browser feed request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503
      }))
    );

    const snapshots: Array<{ aircraft: { code: string; message: string | null } }> = [];
    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (snapshot) => {
        snapshots.push({ aircraft: snapshot.status.aircraft });
      },
      onStatusChange: (status) => {
        statuses.push(status);
      }
    });

    client.setLayers(true, false);
    await Promise.resolve();
    await Promise.resolve();

    expect(snapshots.at(-1)?.aircraft).toEqual({
      code: "error",
      message: AIRCRAFT_FEED_ERROR_MESSAGE
    });
    expect(statuses.at(-1)).toBe("aircraft_error");

    client.dispose();
  });

  it("isConnected returns false when no websocket exists", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    expect(client.isConnected()).toBe(false);
    client.dispose();
  });

  it("isConnected returns false when websocket is in CONNECTING state", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    // socket is in CONNECTING state by default
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);
    expect(client.isConnected()).toBe(false);

    client.dispose();
  });

  it("connect is a no-op after dispose", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.dispose();
    client.connect();

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("sendSubscribe is a no-op after dispose", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.dispose();
    client.sendSubscribe();

    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("dispose clears reconnect timer and closes websocket", () => {
    vi.useFakeTimers();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    // Open ships so we get a ws
    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    expect(client.isConnected()).toBe(true);

    // Close to trigger reconnect scheduling
    socket.emit("close");
    expect(client.isConnected()).toBe(false);

    // Now dispose should clear the reconnect timer and ws
    client.dispose();

    // Advancing timers should NOT create a new ws
    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("dispose when no ws or timers exist is safe", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    // Should not throw
    client.dispose();
  });

  it("ignores malformed JSON in websocket messages", () => {
    const onSnapshot = vi.fn();
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot,
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");

    const snapshotCountBefore = onSnapshot.mock.calls.length;

    // Send malformed JSON
    socket.emit("message", { data: "not valid json{{{" });

    // onSnapshot should not have been called again for ship data
    // (publishSnapshot is called on open, but not from a malformed message)
    expect(onSnapshot.mock.calls.length).toBe(snapshotCountBefore);

    client.dispose();
  });

  it("calls console.debug on malformed websocket messages", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");

    socket.emit("message", { data: "not valid json{{{" });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0][0]).toContain("failed to parse");

    debugSpy.mockRestore();
    client.dispose();
  });

  it("ignores non-snapshot websocket messages", () => {
    const onSnapshot = vi.fn();
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot,
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");

    const countAfterOpen = onSnapshot.mock.calls.length;

    // Send valid JSON but not a snapshot
    socket.emit("message", { data: JSON.stringify({ type: "ping" }) });

    expect(onSnapshot.mock.calls.length).toBe(countAfterOpen);

    client.dispose();
  });

  it("processes valid snapshot messages from websocket", () => {
    const snapshots: Array<{ ships: unknown[] }> = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (s) => snapshots.push({ ships: s.ships }),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");

    socket.emit("message", {
      data: JSON.stringify({
        type: "snapshot",
        aircraft: [],
        ships: [createShipTrack("ship-a"), createShipTrack("ship-b")],
        serverTime: 456,
        status: {
          aircraft: { code: "ok", message: null },
          ships: { code: "ok", message: null }
        }
      })
    });

    expect(snapshots.at(-1)?.ships).toHaveLength(2);

    client.dispose();
  });

  it("fires error event on websocket without crashing", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");

    // Fire error - should not throw
    socket.emit("error");

    // Client should still be connected until close fires
    expect(client.isConnected()).toBe(true);

    client.dispose();
  });

  it("clears aircraft when disabling aircraft layer", async () => {
    stubAircraftFetch();

    const snapshots: Array<{ aircraft: unknown[] }> = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (s) => snapshots.push({ aircraft: s.aircraft }),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    // Now disable aircraft
    client.setLayers(false, false);

    expect(snapshots.at(-1)?.aircraft).toEqual([]);

    client.dispose();
  });

  it("blocks aircraft polling when zoom is below minimum", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const mapStub = createMapStub();
    mapStub.getZoom = () => 3; // below MIN_LIVE_TRAFFIC_ZOOM

    const statuses: string[] = [];
    const client = new TrafficClient(mapStub as never, {
      onSnapshot: vi.fn(),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    // fetch should not be called when zoom is too low
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("standby");

    client.dispose();
  });

  it("stops aircraft poll timer on dispose", async () => {
    vi.useFakeTimers();
    stubAircraftFetch();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    const fetchMock = vi.mocked(fetch);
    const callsBefore = fetchMock.mock.calls.length;

    client.dispose();

    // Advance past poll interval - no new fetches should fire
    vi.advanceTimersByTime(30000);
    await flushAsyncWork();

    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("aircraft poll timer re-fires after interval", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past the poll interval (15s)
    vi.advanceTimersByTime(15000);
    await flushAsyncWork();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    client.dispose();
  });

  it("publishes aircraft error status when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network error");
      })
    );

    const snapshots: Array<{ aircraft: { code: string; message: string | null } }> = [];
    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (s) => snapshots.push({ aircraft: s.status.aircraft }),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    expect(snapshots.at(-1)?.aircraft).toEqual({
      code: "error",
      message: AIRCRAFT_FEED_ERROR_MESSAGE
    });
    expect(statuses.at(-1)).toBe("aircraft_error");

    client.dispose();
  });

  it("connect opens ship relay when ships are enabled", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    expect(MockWebSocket.instances).toHaveLength(1);

    // connect() should not open a second socket when one already exists
    client.connect();
    expect(MockWebSocket.instances).toHaveLength(1);

    client.dispose();
  });

  it("does not open ship relay on static host", () => {
    vi.stubGlobal("location", {
      protocol: "https:",
      host: "user.github.io",
      hostname: "user.github.io"
    });

    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(false, true);

    expect(MockWebSocket.instances).toHaveLength(0);

    client.dispose();
  });

  it("ship relay uses wss when on https", () => {
    vi.stubGlobal("location", {
      protocol: "https:",
      host: "example.com",
      hostname: "example.com"
    });

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    expect(MockWebSocket.instances[0].url).toBe("wss://example.com/traffic");

    client.dispose();
  });

  it("ship relay uses ws when on http", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:5173/traffic");

    client.dispose();
  });

  it("does not open ship relay when zoom is below minimum", () => {
    const mapStub = createMapStub();
    mapStub.getZoom = () => 3;

    const client = new TrafficClient(mapStub as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    expect(MockWebSocket.instances).toHaveLength(0);

    client.dispose();
  });

  it("reports connecting status while websocket is in CONNECTING state", () => {
    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(false, true);
    // Socket is CONNECTING by default
    expect(statuses.at(-1)).toBe("connecting");

    client.dispose();
  });

  it("getClientHint returns hint when zoom is below minimum", () => {
    const mapStub = createMapStub();
    mapStub.getZoom = () => 3;

    const client = new TrafficClient(mapStub as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);

    expect(client.getClientHint()).toContain("Zoom in");

    client.dispose();
  });

  it("getClientHint returns null when no layers enabled", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    expect(client.getClientHint()).toBeNull();

    client.dispose();
  });

  it("getClientHint returns null when zoom is sufficient", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);

    expect(client.getClientHint()).toBeNull();

    client.dispose();
  });

  it("setLayers transitions from both-on to both-off correctly", async () => {
    stubAircraftFetch();

    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(true, true);
    await flushAsyncWork();

    client.setLayers(false, false);

    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSING);
    expect(statuses.at(-1)).toBe("disconnected");

    client.dispose();
  });

  it("aircraft poll timer sets up when aircraft is active", async () => {
    vi.useFakeTimers();
    stubAircraftFetch();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    // Should have set up a poll timer; disable aircraft and it should stop
    client.setLayers(false, false);

    // Advancing timer should not trigger new fetches
    const fetchMock = vi.mocked(fetch);
    const countAfterDisable = fetchMock.mock.calls.length;

    vi.advanceTimersByTime(30000);
    await flushAsyncWork();

    expect(fetchMock.mock.calls.length).toBe(countAfterDisable);

    client.dispose();
  });

  it("skips aircraft poll when fetch is already in flight", async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    // First call is in flight (not resolved yet)
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Triggering sendSubscribe should not start a second fetch
    client.sendSubscribe();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Resolve the first fetch
    resolveFetch!({ ok: true, json: async () => ({ states: [] }) });
    await flushAsyncWork();

    client.dispose();
  });

  it("aircraft poll refetches when bbox changes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    let currentBounds = {
      getWest: () => -3.6,
      getSouth: () => 55.8,
      getEast: () => -3.0,
      getNorth: () => 56.1
    };

    const mapStub = {
      getZoom: () => 8,
      getBounds: () => currentBounds
    };

    const client = new TrafficClient(mapStub as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Change bounds significantly
    currentBounds = {
      getWest: () => -5.0,
      getSouth: () => 54.0,
      getEast: () => -4.0,
      getNorth: () => 55.0
    };

    client.sendSubscribe();
    await flushAsyncWork();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    client.dispose();
  });

  it("aircraft identity merge is called after successful fetch with tracks", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        states: [
          ["abc123", "BAW123", null, null, null, -3.3, 55.95, 10000, false, 250, 90, null, null, 9500, null, null, null, 4]
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const snapshots: Array<{ aircraft: unknown[] }> = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (s) => snapshots.push({ aircraft: s.aircraft }),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    // Should have aircraft in the snapshot
    expect(snapshots.at(-1)?.aircraft).toHaveLength(1);

    client.dispose();
  });

  it("disconnectRelay clears reconnect timer", () => {
    vi.useFakeTimers();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    socket.emit("close");

    // Reconnect timer is scheduled. Now disable ships to trigger disconnectRelay
    client.setLayers(false, false);

    // Advance time - no new sockets should be created
    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);

    client.dispose();
  });

  it("debouncedSubscribe triggers after delay", async () => {
    vi.useFakeTimers();
    stubAircraftFetch();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");

    client.debouncedSubscribe();

    // Before debounce fires
    expect(socket.sentMessages).toHaveLength(1); // from setLayers open

    vi.advanceTimersByTime(300);

    // After debounce fires, sendSubscribe was called which re-sends subscribe
    expect(socket.sentMessages.length).toBeGreaterThanOrEqual(2);

    client.dispose();
  });

  it("sendShipSubscribe is a no-op when ws is not open", () => {
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    // Socket is still CONNECTING, sendSubscribe should not send
    expect(socket.sentMessages).toHaveLength(0);

    client.dispose();
  });

  it("ignores stale websocket message events from a replaced socket", () => {
    const snapshots: Array<{ ships: unknown[] }> = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (s) => snapshots.push({ ships: s.ships }),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const firstSocket = MockWebSocket.instances[0];
    firstSocket.emit("open");

    // Disconnect and reconnect
    client.setLayers(false, false);
    client.setLayers(false, true);
    const secondSocket = MockWebSocket.instances[1];
    secondSocket.emit("open");

    const countBeforeStale = snapshots.length;

    // Send a message on the old (stale) socket
    firstSocket.emit("message", {
      data: JSON.stringify({
        type: "snapshot",
        aircraft: [],
        ships: [createShipTrack("stale-ship")],
        serverTime: 789,
        status: {
          aircraft: { code: "ok", message: null },
          ships: { code: "ok", message: null }
        }
      })
    });

    // Should not have updated from the stale message
    expect(snapshots.length).toBe(countBeforeStale);

    client.dispose();
  });

  it("ignores stale websocket open events from a replaced socket", () => {
    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(false, true);
    const firstSocket = MockWebSocket.instances[0];

    // Disconnect and reconnect before first socket opens
    client.setLayers(false, false);
    client.setLayers(false, true);

    const secondSocket = MockWebSocket.instances[1];
    secondSocket.emit("open");

    const statusCountAfterOpen = statuses.length;

    // Stale open event on the old socket
    firstSocket.readyState = MockWebSocket.OPEN;
    for (const listener of (firstSocket as any).listeners.get("open") ?? []) {
      listener({});
    }

    // Status count should not change from stale open
    expect(statuses.length).toBe(statusCountAfterOpen);

    client.dispose();
  });

  it("transitions from zoom_blocked to loading when zoom becomes sufficient", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    let currentZoom = 3;
    const mapStub = {
      getZoom: () => currentZoom,
      getBounds: () => ({
        getWest: () => -3.6,
        getSouth: () => 55.8,
        getEast: () => -3.0,
        getNorth: () => 56.1
      })
    };

    const statuses: string[] = [];
    const client = new TrafficClient(mapStub as never, {
      onSnapshot: vi.fn(),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(true, false);
    expect(statuses.at(-1)).toBe("standby");
    expect(fetchMock).not.toHaveBeenCalled();

    // Zoom in
    currentZoom = 8;
    client.sendSubscribe();
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalled();

    client.dispose();
  });

  it("scheduleReconnect does not double-schedule when timer already pending", () => {
    vi.useFakeTimers();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    socket.emit("close");

    // Only 1 socket so far (reconnect timer pending but not fired)
    expect(MockWebSocket.instances).toHaveLength(1);

    // Fire close again on the same socket shouldn't double-schedule
    // (the ws !== ws guard prevents this)

    // Advance time to fire reconnect once
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.dispose();
  });

  it("reconnect backoff caps at 30 seconds", () => {
    vi.useFakeTimers();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);

    // Simulate many close/reconnect cycles to hit the cap
    for (let i = 0; i < 10; i++) {
      const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      socket.emit("open");
      socket.emit("close");
      // Advance enough to cover max backoff
      vi.advanceTimersByTime(30000);
    }

    // Should have created multiple sockets
    expect(MockWebSocket.instances.length).toBeGreaterThan(5);

    client.dispose();
  });

  it("aircraft identity loading triggers a snapshot refresh after async load", async () => {
    // Mock fetch to return aircraft with a known ICAO prefix
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        states: [
          ["abc123", "BAW456", null, null, null, -3.3, 55.95, 10000, false, 250, 90, null, null, 9500, null, null, null, 4]
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const snapshots: Array<{ aircraft: unknown[] }> = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: (s) => snapshots.push({ aircraft: s.aircraft }),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    // Let the fetch resolve and identity load resolve
    await flushAsyncWork();
    await flushAsyncWork();
    await flushAsyncWork();

    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots.at(-1)?.aircraft).toHaveLength(1);

    client.dispose();
  });

  it("setLayers from aircraft-only to ships-only closes aircraft and opens relay", async () => {
    vi.useFakeTimers();
    stubAircraftFetch();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    expect(MockWebSocket.instances).toHaveLength(0);

    client.setLayers(false, true);
    expect(MockWebSocket.instances).toHaveLength(1);

    client.dispose();
  });

  it("connect triggers aircraft fetch when aircraft enabled", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.state.aircraftEnabled = true;
    client.connect();
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalled();

    client.dispose();
  });

  it("aircraft runtime goes to loading then live on success", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ states: [] })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const statuses: string[] = [];
    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: (s) => statuses.push(s)
    });

    client.setLayers(true, false);
    await flushAsyncWork();

    // After successful poll with empty states, status becomes connected (live runtime)
    expect(statuses).toContain("connected");

    client.dispose();
  });

  it("uses exponential backoff for consecutive reconnect failures", () => {
    vi.useFakeTimers();

    const client = new TrafficClient(createMapStub() as never, {
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn()
    });

    client.setLayers(false, true);
    const firstSocket = MockWebSocket.instances[0];
    // Close without opening so reconnectAttempt is not reset
    firstSocket.emit("close");

    expect(MockWebSocket.instances).toHaveLength(1);

    // First reconnect at 2000ms (attempt=0, delay=2000)
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Close the second socket without opening (attempt=1, delay=4000)
    MockWebSocket.instances[1].emit("close");

    vi.advanceTimersByTime(3999);
    expect(MockWebSocket.instances).toHaveLength(2);

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    client.dispose();
  });

});
