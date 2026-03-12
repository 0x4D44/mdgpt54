import { describe, expect, it } from "vitest";
import { TrafficRelayCore, isValidSubscribeMessage, sameBbox } from "./trafficRelayCore";
import type { Bbox, LiveTrack, SubscribeMessage } from "./trafficModel";

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

function aircraftTrack(id: string, lng: number, lat: number, updatedAt = 1_000): LiveTrack {
  return {
    id,
    kind: "aircraft",
    lng,
    lat,
    heading: 90,
    speedKnots: 200,
    altitudeMeters: 3_000,
    label: id,
    source: "opensky",
    updatedAt,
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
});

describe("TrafficRelayCore", () => {
  it("shares a union bbox while filtering aircraft per client", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });

    relay.addClient("alpha");
    relay.addClient("bravo");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: true, ships: false }));
    relay.setClientSubscription("bravo", subscribe([2, 2, 3, 3], { aircraft: true, ships: false }));
    relay.setAircraftTracks([
      aircraftTrack("A", 0.5, 0.5),
      aircraftTrack("B", 2.5, 2.5),
      aircraftTrack("C", 4.5, 4.5),
    ]);

    expect(relay.getActiveAircraftBbox()).toEqual([0, 0, 3, 3]);

    const alphaSnapshot = relay.getClientSnapshot("alpha");
    const bravoSnapshot = relay.getClientSnapshot("bravo");

    expect(alphaSnapshot?.aircraft.map((track) => track.id)).toEqual(["A"]);
    expect(bravoSnapshot?.aircraft.map((track) => track.id)).toEqual(["B"]);
    expect(alphaSnapshot?.status.aircraft.code).toBe("ok");
    expect(bravoSnapshot?.status.aircraft.code).toBe("ok");
  });

  it("refuses oversized layers and returns zoom-in status with empty data", () => {
    const relay = new TrafficRelayCore<string>({ shipsAvailable: true });

    relay.addClient("accepted");
    relay.addClient("rejected");

    relay.setClientSubscription(
      "accepted",
      subscribe([-3.6, 55.8, -3.0, 56.1], { aircraft: true, ships: true }),
    );
    relay.setAircraftTracks([aircraftTrack("plane", -3.3, 55.9)]);
    relay.upsertShipTrack(shipTrack("ship", -3.2, 55.95, 1_000));

    relay.setClientSubscription(
      "rejected",
      subscribe([-180, -90, 180, 90], { aircraft: true, ships: true }),
    );

    const rejectedSnapshot = relay.getClientSnapshot("rejected");
    expect(rejectedSnapshot?.aircraft).toEqual([]);
    expect(rejectedSnapshot?.ships).toEqual([]);
    expect(rejectedSnapshot?.status.aircraft.code).toBe("zoom_in");
    expect(rejectedSnapshot?.status.ships.code).toBe("zoom_in");
    expect(relay.getActiveAircraftBbox()).toEqual([-3.6, 55.8, -3.0, 56.1]);
    expect(relay.getActiveShipBbox()).toEqual([-3.6, 55.8, -3.0, 56.1]);
  });

  it("keeps the OpenSky floor across churn from zero subscribers", () => {
    let now = 1_000;
    const relay = new TrafficRelayCore<string>({
      shipsAvailable: true,
      now: () => now,
      minOpenSkyPollMs: 10_000,
    });

    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: true, ships: false }));
    expect(relay.getNextOpenSkyPollDelay()).toBe(0);

    relay.markOpenSkyPoll();
    relay.removeClient("alpha");

    now = 5_000;
    relay.addClient("alpha");
    relay.setClientSubscription("alpha", subscribe([0, 0, 1, 1], { aircraft: true, ships: false }));
    expect(relay.getNextOpenSkyPollDelay()).toBe(6_000);

    now = 11_000;
    expect(relay.getNextOpenSkyPollDelay()).toBe(0);
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
});
