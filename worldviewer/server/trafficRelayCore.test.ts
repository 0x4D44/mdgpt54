import { describe, expect, it } from "vitest";
import {
  TrafficRelayCore,
  expireStaleTracks,
  isValidSubscribeMessage,
  sameBbox,
} from "./trafficRelayCore";
import type { Bbox, LiveTrack, SubscribeMessage } from "../src/traffic/trafficTypes";

function subscribe(
  bbox: Bbox,
  layers: SubscribeMessage["layers"],
  zoom?: number,
): SubscribeMessage {
  return {
    type: "subscribe",
    bbox,
    ...(zoom === undefined ? {} : { zoom }),
    layers,
  };
}

function shipTrack(id: string, lng: number, lat: number, updatedAt: number): LiveTrack {
  return {
    id,
    kind: "ship",
    lng,
    lat,
    heading: 120,
    speedKnots: 12,
    altitudeMeters: null,
    label: id,
    source: "aisstream",
    updatedAt,
  };
}

describe("isValidSubscribeMessage", () => {
  it("accepts a subscribe message without zoom", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(true);
  });

  it("accepts a subscribe message with a valid zoom", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        zoom: 10,
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(true);
  });

  it("rejects a subscribe message with a non-finite zoom", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        zoom: NaN,
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        zoom: Infinity,
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
  });

  it("rejects when layers is not an object", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        layers: null,
      }),
    ).toBe(false);
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        layers: "both",
      }),
    ).toBe(false);
  });

  it("rejects when layers.aircraft or layers.ships is not boolean", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        layers: { aircraft: "yes", ships: true },
      }),
    ).toBe(false);
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        layers: { aircraft: true, ships: 1 },
      }),
    ).toBe(false);
  });

  it("rejects when bbox contains non-finite numbers", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [NaN, 0, 1, 1],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
  });

  it("rejects invalid bbox coordinates", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -181, 56.1],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.0, 55.8, -3.6, 56.1],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
  });

  it("rejects when south >= north", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 56.1, -3.0, 55.8],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
  });

  it("rejects out-of-range latitude", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, -91, -3.0, 56.1],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0, 91],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
  });

  it("rejects non-object and null input", () => {
    expect(isValidSubscribeMessage(null)).toBe(false);
    expect(isValidSubscribeMessage(42)).toBe(false);
    expect(isValidSubscribeMessage("subscribe")).toBe(false);
  });

  it("rejects wrong type field", () => {
    expect(
      isValidSubscribeMessage({
        type: "unsubscribe",
        bbox: [-3.6, 55.8, -3.0, 56.1],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
  });

  it("rejects bbox with wrong length", () => {
    expect(
      isValidSubscribeMessage({
        type: "subscribe",
        bbox: [-3.6, 55.8, -3.0],
        layers: { aircraft: true, ships: false },
      }),
    ).toBe(false);
  });
});

describe("TrafficRelayCore", () => {
  it("shares a union bbox while filtering ships per client", () => {
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      now: () => 1_000,
    });

    relay.addClient("alpha");
    relay.addClient("bravo");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: false, ships: true }));
    relay.setClientSubscription("bravo", subscribe([2, 2, 3, 3], { aircraft: false, ships: true }));
    relay.upsertShipTrack(shipTrack("A", 0.5, 0.5, 1_000));
    relay.upsertShipTrack(shipTrack("B", 2.5, 2.5, 1_000));
    relay.upsertShipTrack(shipTrack("C", 4.5, 4.5, 1_000));

    expect(relay.getActiveShipBbox()).toEqual([0, 0, 3, 3]);

    const alphaSnapshot = relay.getClientSnapshot("alpha");
    const bravoSnapshot = relay.getClientSnapshot("bravo");

    expect(alphaSnapshot?.ships.map((track) => track.id)).toEqual(["A"]);
    expect(bravoSnapshot?.ships.map((track) => track.id)).toEqual(["B"]);
    expect(alphaSnapshot?.status.ships.code).toBe("ok");
    expect(bravoSnapshot?.status.ships.code).toBe("ok");
  });

  it("treats aircraft requests as unavailable while still enforcing ship bbox limits", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });

    relay.addClient("accepted");
    relay.addClient("rejected");

    relay.setClientSubscription(
      "accepted",
      subscribe([-3.6, 55.8, -3.0, 56.1], { aircraft: true, ships: true }),
    );
    relay.upsertShipTrack(shipTrack("ship", -3.2, 55.95, 1_000));

    relay.setClientSubscription(
      "rejected",
      subscribe([-180, -90, 180, 90], { aircraft: true, ships: true }),
    );

    const rejectedSnapshot = relay.getClientSnapshot("rejected");
    expect(rejectedSnapshot?.aircraft).toEqual([]);
    expect(rejectedSnapshot?.ships).toEqual([]);
    expect(rejectedSnapshot?.status.aircraft.code).toBe("unavailable");
    expect(rejectedSnapshot?.status.ships.code).toBe("zoom_in");
    expect(relay.getActiveShipBbox()).toEqual([-3.6, 55.8, -3.0, 56.1]);
  });

  it("expires stale ship tracks before building snapshots", () => {
    let now = 1_000_000;
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      shipStaleMs: 300_000,
      now: () => now,
    });

    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 10, 10], { aircraft: false, ships: true }));
    relay.upsertShipTrack(shipTrack("fresh", 1, 1, now - 10_000));
    relay.upsertShipTrack(shipTrack("stale", 2, 2, now - 400_000));

    const snapshot = relay.getClientSnapshot("alpha");
    expect(snapshot?.ships.map((track) => track.id)).toEqual(["fresh"]);
    expect(relay.getShipTrackCount()).toBe(1);
  });

  it("does not change the shared ship bbox for aircraft-only churn", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });

    relay.addClient("ship-client");
    relay.addClient("aircraft-client");
    relay.setClientSubscription(
      "ship-client",
      subscribe([-3.6, 55.8, -3.0, 56.1], { aircraft: false, ships: true }),
    );

    const previousShipBbox = relay.getActiveShipBbox();

    relay.setClientSubscription(
      "aircraft-client",
      subscribe([10, 10, 11, 11], { aircraft: true, ships: false }),
    );

    expect(sameBbox(previousShipBbox, relay.getActiveShipBbox())).toBe(true);
  });

  it("reports ships unavailable when the relay has no AIS key", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: false });

    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: false, ships: true }));

    const snapshot = relay.getClientSnapshot("alpha");
    expect(snapshot?.ships).toEqual([]);
    expect(snapshot?.status.ships.code).toBe("unavailable");
    expect(relay.getActiveShipBbox()).toBeNull();
  });

  it("merges a cached ship name into a position report that has no label", () => {
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      now: () => 1_000,
    });

    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 10, 10], { aircraft: false, ships: true }));

    // First: receive static data with a name
    relay.applyShipStatic({ mmsi: "123", name: "STAR VOYAGER" });

    // Then: receive a position report without a label
    const track: LiveTrack = {
      id: "123",
      kind: "ship",
      lng: 5,
      lat: 5,
      heading: 90,
      speedKnots: 10,
      altitudeMeters: null,
      label: null,
      source: "aisstream",
      updatedAt: 1_000,
    };
    relay.upsertShipTrack(track);

    const snapshot = relay.getClientSnapshot("alpha");
    const ship = snapshot?.ships.find((s) => s.id === "123");
    expect(ship?.label).toBe("STAR VOYAGER");
  });

  it("applyShipStatic updates label on an existing position", () => {
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      now: () => 1_000,
    });

    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 10, 10], { aircraft: false, ships: true }));

    // Insert a track first
    relay.upsertShipTrack(shipTrack("456", 3, 3, 1_000));

    // Then apply static data for same MMSI
    relay.applyShipStatic({ mmsi: "456", name: "OCEAN QUEEN" });

    const snapshot = relay.getClientSnapshot("alpha");
    const ship = snapshot?.ships.find((s) => s.id === "456");
    expect(ship?.label).toBe("OCEAN QUEEN");
  });

  it("evicts cached ship names when positions expire", () => {
    let now = 1_000_000;
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      shipStaleMs: 300_000,
      now: () => now,
    });

    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 10, 10], { aircraft: false, ships: true }));

    // Add a ship with a cached name
    relay.upsertShipTrack(shipTrack("old-ship", 1, 1, now - 400_000));
    relay.applyShipStatic({ mmsi: "old-ship", name: "LOST AT SEA" });

    // Expire it
    relay.expireStaleShips(now);
    expect(relay.getShipTrackCount()).toBe(0);

    // Insert a new position for the same MMSI without a label
    // The cached name should have been evicted so the label stays null
    const track: LiveTrack = {
      id: "old-ship",
      kind: "ship",
      lng: 1,
      lat: 1,
      heading: 0,
      speedKnots: 5,
      altitudeMeters: null,
      label: null,
      source: "aisstream",
      updatedAt: now,
    };
    relay.upsertShipTrack(track);

    const snapshot = relay.getClientSnapshot("alpha");
    const ship = snapshot?.ships.find((s) => s.id === "old-ship");
    expect(ship?.label).toBeNull();
  });

  it("returns null snapshot for a client with no subscription", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });
    relay.addClient("alpha");
    expect(relay.getClientSnapshot("alpha")).toBeNull();
  });

  it("returns null snapshot for an unknown client", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });
    expect(relay.getClientSnapshot("unknown")).toBeNull();
  });

  it("iterates client IDs", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });
    relay.addClient("a");
    relay.addClient("b");
    expect([...relay.clientIds()]).toEqual(["a", "b"]);
  });

  it("reports zero ship tracks when none are inserted", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });
    expect(relay.getShipTrackCount()).toBe(0);
  });

  it("clears all ship state", () => {
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      now: () => 1_000,
    });
    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 10, 10], { aircraft: false, ships: true }));
    relay.upsertShipTrack(shipTrack("A", 1, 1, 1_000));
    relay.applyShipStatic({ mmsi: "A", name: "SHIPPY" });

    expect(relay.getShipTrackCount()).toBe(1);
    relay.clearShipState();
    expect(relay.getShipTrackCount()).toBe(0);
  });

  it("uses default options when none provided", () => {
    const relay = new TrafficRelayCore<string>();
    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: false, ships: true }));
    // shipsAvailable defaults to false, so ships should be unavailable
    const snapshot = relay.getClientSnapshot("alpha");
    expect(snapshot?.status.ships.code).toBe("unavailable");
  });

  it("does not add the same client twice", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });
    relay.addClient("alpha");
    relay.addClient("alpha");
    expect(relay.getClientCount()).toBe(1);
  });

  it("does nothing when removing an unknown client", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });
    relay.removeClient("unknown");
    expect(relay.getClientCount()).toBe(0);
  });

  it("hasActiveShipSubscriptions returns false when no clients subscribe to ships", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });
    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: true, ships: false }));
    expect(relay.hasActiveShipSubscriptions()).toBe(false);
  });

  it("clears ship state when reconcile leaves no active ship subscriptions", () => {
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      now: () => 1_000,
    });
    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: false, ships: true }));
    relay.upsertShipTrack(shipTrack("A", 0.5, 0.5, 1_000));
    expect(relay.getShipTrackCount()).toBe(1);

    // Remove the only ship subscriber; reconcile should clear ship state
    relay.removeClient("alpha");
    expect(relay.getShipTrackCount()).toBe(0);
  });
});

describe("sameBbox", () => {
  it("returns true for two identical bboxes", () => {
    expect(sameBbox([0, 0, 1, 1], [0, 0, 1, 1])).toBe(true);
  });

  it("returns false for different bboxes", () => {
    expect(sameBbox([0, 0, 1, 1], [0, 0, 2, 2])).toBe(false);
  });

  it("returns true when both are null", () => {
    expect(sameBbox(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(sameBbox(null, [0, 0, 1, 1])).toBe(false);
    expect(sameBbox([0, 0, 1, 1], null)).toBe(false);
  });
});

describe("expireStaleTracks", () => {
  it("removes tracks older than the cutoff", () => {
    const tracks = new Map<string, LiveTrack>();
    tracks.set("fresh", shipTrack("fresh", 1, 1, 1_000));
    tracks.set("stale", shipTrack("stale", 2, 2, 100));
    expireStaleTracks(tracks, 500);
    expect([...tracks.keys()]).toEqual(["fresh"]);
  });

  it("keeps all tracks when none are stale", () => {
    const tracks = new Map<string, LiveTrack>();
    tracks.set("a", shipTrack("a", 1, 1, 1_000));
    tracks.set("b", shipTrack("b", 2, 2, 900));
    expireStaleTracks(tracks, 500);
    expect(tracks.size).toBe(2);
  });
});
