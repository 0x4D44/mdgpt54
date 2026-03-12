import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrafficClient } from "./trafficClient";

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
});
