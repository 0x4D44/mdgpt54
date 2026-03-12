import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import type { RenderableAircraft3dTrack } from "./aircraft3d";
import { Aircraft3dController, aircraft3dLayerTestUtils } from "./aircraft3dLayer";
import type { LiveTrack } from "./trafficTypes";

function makeTrack(overrides: Partial<LiveTrack> = {}): LiveTrack {
  return {
    id: "abc123",
    kind: "aircraft",
    lng: -3.2,
    lat: 55.9,
    heading: 90,
    speedKnots: 250,
    altitudeMeters: 10000,
    label: "BAW123",
    source: "opensky",
    updatedAt: 1000000,
    ...overrides
  };
}

function makeMap() {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    on: vi.fn((event: string, handler: () => void) => {
      listeners.set(event, handler);
    }),
    off: vi.fn((event: string, handler: () => void) => {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    }),
    getBounds: vi.fn(() => ({
      getWest: () => -4,
      getSouth: () => 55,
      getEast: () => -3,
      getNorth: () => 56
    })),
    getZoom: vi.fn(() => 11),
    getPitch: vi.fn(() => 50),
    getLayer: vi.fn(() => null),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    triggerRepaint: vi.fn(),
    getCanvas: vi.fn(() => ({}))
  };
}

async function flushAllFrames(queue: Array<(time: number) => void>): Promise<void> {
  let idlePasses = 0;

  while (queue.length > 0 || idlePasses < 3) {
    const callback = queue.shift();
    if (callback) {
      idlePasses = 0;
      callback(0);
    } else {
      idlePasses++;
    }

    await Promise.resolve();
    await Promise.resolve();
  }
}

describe("Aircraft3dController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("warns once and stops retrying when three.js fails to load", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    const onVisibilityChange = vi.fn();
    const loadThree = vi.fn(() => Promise.reject(new Error("load failed")));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = new Aircraft3dController(map as any, onVisibilityChange, loadThree);

    controller.setTracks([makeTrack({ geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(loadThree).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect([...controller.getHiddenTrackIds()]).toEqual([]);

    map.listeners.get("move")?.();
    controller.setTracks([makeTrack({ id: "next", geoAltitudeMeters: 9800 })]);
    await flushAllFrames(frameQueue);

    expect(loadThree).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect([...controller.getHiddenTrackIds()]).toEqual([]);

    controller.dispose();
  });

  it("loads the 3D layer and hides matching 2D aircraft once the success path completes", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    const onVisibilityChange = vi.fn();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, onVisibilityChange, loadThree);

    controller.setTracks([makeTrack({ id: "loaded", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(loadThree).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(onVisibilityChange).toHaveBeenCalledTimes(1);
    expect([...controller.getHiddenTrackIds()]).toEqual(["loaded"]);

    controller.dispose();
  });
});

describe("aircraft3dLayerTestUtils", () => {
  it("keeps fixed-wing fuselage and nose aligned on the forward axis", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);
    const narrowBody = prototypes["narrow-body"];
    const fuselage = narrowBody.getObjectByName("fuselage") as THREE.Mesh | undefined;
    const nose = narrowBody.getObjectByName("nose") as THREE.Mesh | undefined;
    const tailplane = narrowBody.getObjectByName("tailplane") as THREE.Mesh | undefined;
    const tailFin = narrowBody.getObjectByName("tail-fin") as THREE.Mesh | undefined;

    expect(fuselage).toBeTruthy();
    expect(nose).toBeTruthy();
    expect(tailplane).toBeTruthy();
    expect(tailFin).toBeTruthy();
    expect(fuselage?.rotation.z ?? Number.NaN).toBeCloseTo(0);
    expect(nose?.rotation.z ?? Number.NaN).toBeCloseTo(0);
    expect(nose?.position.x ?? Number.NaN).toBeCloseTo(0);
    expect(nose?.position.y ?? Number.NaN).toBeGreaterThan(0);
    expect(tailplane?.position.y ?? Number.NaN).toBeLessThan(0);
    expect(tailFin?.position.y ?? Number.NaN).toBeLessThan(0);
  });

  it("replaces an existing mesh when the track class changes", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);
    const scene = new THREE.Scene();
    const objects = new Map<string, THREE.Group>();
    const track: RenderableAircraft3dTrack = {
      id: "abc123",
      lng: -3.2,
      lat: 55.9,
      heading: 90,
      altitudeMeters: 10000,
      classKey: "narrow-body"
    };

    aircraft3dLayerTestUtils.syncAircraftObjects(scene, objects, prototypes, [track]);
    const firstInstance = objects.get(track.id);

    aircraft3dLayerTestUtils.syncAircraftObjects(scene, objects, prototypes, [{ ...track, classKey: "wide-body" }]);
    const secondInstance = objects.get(track.id);

    expect(firstInstance).toBeTruthy();
    expect(secondInstance).toBeTruthy();
    expect(secondInstance).not.toBe(firstInstance);
    expect(scene.children).toContain(secondInstance);
    expect(scene.children).not.toContain(firstInstance);
    expect(secondInstance?.userData.aircraftClassKey).toBe("wide-body");
  });

  it("maps local forward movement onto the requested world heading", () => {
    const matrix = new THREE.Matrix4();
    const track: RenderableAircraft3dTrack = {
      id: "abc123",
      lng: -3.2,
      lat: 55.9,
      heading: 90,
      altitudeMeters: 10000,
      classKey: "narrow-body"
    };
    const origin = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(0, 1, 0);

    aircraft3dLayerTestUtils.applyAircraftModelMatrix(THREE, matrix, track);

    origin.applyMatrix4(matrix);
    forward.applyMatrix4(matrix).sub(origin);

    expect(forward.x).toBeGreaterThan(0);
    expect(Math.abs(forward.y)).toBeLessThan(forward.x * 0.01);
    expect(Math.abs(forward.z)).toBeLessThan(forward.x * 0.01);
  });
});
