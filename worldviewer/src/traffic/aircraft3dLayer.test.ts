import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

import type { RenderableAircraft3dTrack } from "./aircraft3d";
import { Aircraft3dController, aircraft3dLayerTestUtils } from "./aircraft3dLayer";
import type { CustomLayerInterface } from "maplibre-gl";
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

function makeMap({ zoom = 14, pitch = 50 }: { zoom?: number; pitch?: number } = {}) {
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
    getZoom: vi.fn(() => zoom),
    getPitch: vi.fn(() => pitch),
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

  it("keeps 2D aircraft visible below the closer 3D handoff zoom", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap({ zoom: 13.49, pitch: 55 });
    const onVisibilityChange = vi.fn();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, onVisibilityChange, loadThree);

    controller.setTracks([makeTrack({ id: "still-2d", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(loadThree).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect([...controller.getHiddenTrackIds()]).toEqual([]);

    controller.dispose();
  });

  it("keeps 2D aircraft visible when a narrow-body is still smaller than the 2D handoff floor", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap({ zoom: 13.5, pitch: 55 });
    const onVisibilityChange = vi.fn();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, onVisibilityChange, loadThree);

    controller.setTracks([
      makeTrack({
        id: "still-2d-narrow",
        geoAltitudeMeters: 10400
      })
    ]);
    await flushAllFrames(frameQueue);

    expect(loadThree).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect([...controller.getHiddenTrackIds()]).toEqual([]);

    controller.dispose();
  });

  it("hides only aircraft that pass the per-track handoff filter", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap({ zoom: 13.5, pitch: 55 });
    const onVisibilityChange = vi.fn();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, onVisibilityChange, loadThree);

    controller.setTracks([
      makeTrack({
        id: "eligible-wide",
        geoAltitudeMeters: 10400,
        renderModelKey: "boeing-787-family"
      }),
      makeTrack({
        id: "ineligible-narrow",
        geoAltitudeMeters: 10400
      })
    ]);
    await flushAllFrames(frameQueue);

    expect(loadThree).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(onVisibilityChange).toHaveBeenCalledTimes(1);
    expect([...controller.getHiddenTrackIds()]).toEqual(["eligible-wide"]);

    controller.dispose();
  });

  it("cancels a pending animation frame on dispose", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    const cancelSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", cancelSpy);

    const map = makeMap();
    const controller = new Aircraft3dController(map as any, vi.fn(), async () => THREE);

    controller.setTracks([makeTrack({ geoAltitudeMeters: 10400 })]);
    // Frame is scheduled but not yet flushed — dispose should cancel it.
    controller.dispose();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledWith("move", expect.any(Function));
  });

  it("removes the map layer on dispose when it is present", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, vi.fn(), loadThree);

    controller.setTracks([makeTrack({ id: "dispose-test", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(map.addLayer).toHaveBeenCalledTimes(1);

    // After the layer is loaded, getLayer should report it as present for the dispose path.
    map.getLayer.mockReturnValue({});
    controller.dispose();

    expect(map.removeLayer).toHaveBeenCalledTimes(1);
  });

  it("does not fire visibility change when hidden track ids stay the same", async () => {
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

    controller.setTracks([makeTrack({ id: "stable", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(onVisibilityChange).toHaveBeenCalledTimes(1);
    expect([...controller.getHiddenTrackIds()]).toEqual(["stable"]);

    // Re-sync with the same track should not fire again.
    controller.setTracks([makeTrack({ id: "stable", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(onVisibilityChange).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("does not sync when disposed mid-frame", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, vi.fn(), loadThree);

    controller.setTracks([makeTrack({ geoAltitudeMeters: 10400 })]);
    // Dispose before the frame fires.
    controller.dispose();

    // Flush remaining frames — the callback should early-return.
    await flushAllFrames(frameQueue);

    expect(loadThree).not.toHaveBeenCalled();
  });

  it("calls onAdd, render, and onRemove on the runtime layer lifecycle", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    const mockRenderer = {
      autoClear: true,
      resetState: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn()
    };
    let constructorCalls = 0;
    let lastInstance: any = null;
    class MockWebGLRenderer {
      autoClear = true;
      resetState = mockRenderer.resetState;
      render = mockRenderer.render;
      dispose = mockRenderer.dispose;
      constructor() {
        constructorCalls++;
        lastInstance = this;
      }
    }
    const mockThree = {
      ...THREE,
      WebGLRenderer: MockWebGLRenderer as any
    };
    const loadThree = vi.fn(async () => mockThree as any);
    const controller = new Aircraft3dController(map as any, vi.fn(), loadThree);

    controller.setTracks([makeTrack({ id: "render-test", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(map.addLayer).toHaveBeenCalledTimes(1);
    const layer = map.addLayer.mock.calls[0][0] as CustomLayerInterface;

    // Exercise onAdd — sets up the renderer.
    const mockGl = {} as WebGLRenderingContext;
    layer.onAdd!(map as any, mockGl);
    expect(constructorCalls).toBe(1);
    expect(lastInstance.autoClear).toBe(false);

    // Exercise render — needs a projection matrix.
    const projectionMatrix = new Float64Array(16);
    projectionMatrix[0] = 1;
    projectionMatrix[5] = 1;
    projectionMatrix[10] = 1;
    projectionMatrix[15] = 1;
    layer.render!(mockGl, {
      defaultProjectionData: {
        mainMatrix: projectionMatrix,
        farZ: 1,
        nearZ: 0,
        shaderData: { useStencilMasking: false, isInShadowPass: false }
      }
    });
    expect(mockRenderer.resetState).toHaveBeenCalledTimes(1);
    expect(mockRenderer.render).toHaveBeenCalledTimes(1);

    // Exercise onRemove — disposes everything.
    layer.onRemove!(map as any, mockGl);
    expect(mockRenderer.dispose).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("render returns early when no renderer is attached", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, vi.fn(), loadThree);

    controller.setTracks([makeTrack({ id: "no-renderer", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    const layer = map.addLayer.mock.calls[0][0] as CustomLayerInterface;

    // Render without calling onAdd first — renderer is null, should early-return without throwing.
    const mockGl = {} as WebGLRenderingContext;
    const projectionMatrix = new Float64Array(16);
    projectionMatrix[0] = 1;
    projectionMatrix[5] = 1;
    projectionMatrix[10] = 1;
    projectionMatrix[15] = 1;
    expect(() => {
      layer.render!(mockGl, {
        defaultProjectionData: {
          mainMatrix: projectionMatrix,
          farZ: 1,
          nearZ: 0,
          shaderData: { useStencilMasking: false, isInShadowPass: false }
        }
      });
    }).not.toThrow();

    controller.dispose();
  });

  it("does not create a second layer when ensureLayer is called while already loaded", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, vi.fn(), loadThree);

    controller.setTracks([makeTrack({ id: "first", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    // Trigger a second sync with a different track — layer already exists.
    controller.setTracks([makeTrack({ id: "second", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect(loadThree).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("clears hidden track ids when 3D mode is disabled by zooming out", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap({ zoom: 14, pitch: 50 });
    const onVisibilityChange = vi.fn();
    const loadThree = vi.fn(async () => THREE);
    const controller = new Aircraft3dController(map as any, onVisibilityChange, loadThree);

    controller.setTracks([makeTrack({ id: "zoom-test", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect([...controller.getHiddenTrackIds()]).toEqual(["zoom-test"]);

    // Zoom out far enough to disable 3D mode.
    map.getZoom.mockReturnValue(12);
    controller.setTracks([makeTrack({ id: "zoom-test", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    expect([...controller.getHiddenTrackIds()]).toEqual([]);

    controller.dispose();
  });

  it("does not load three.js when disposed before ensureLayer resolves", async () => {
    const frameQueue: Array<(time: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: (time: number) => void) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const map = makeMap();
    let resolveThree!: (value: typeof THREE) => void;
    const threePromise = new Promise<typeof THREE>((resolve) => {
      resolveThree = resolve;
    });
    const loadThree = vi.fn(() => threePromise);
    const controller = new Aircraft3dController(map as any, vi.fn(), loadThree);

    controller.setTracks([makeTrack({ id: "pending", geoAltitudeMeters: 10400 })]);
    await flushAllFrames(frameQueue);

    // Dispose while the promise is still pending.
    controller.dispose();

    // Now resolve — the .then callback should bail out because disposed.
    resolveThree(THREE);
    await threePromise;
    await Promise.resolve();
    await Promise.resolve();

    expect(map.addLayer).not.toHaveBeenCalled();
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

  it("defaults to heading 0 when heading is null", () => {
    const matrix = new THREE.Matrix4();
    const track: RenderableAircraft3dTrack = {
      id: "no-heading",
      lng: -3.2,
      lat: 55.9,
      heading: null,
      altitudeMeters: 10000,
      classKey: "narrow-body"
    };
    const origin = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(0, 1, 0);

    aircraft3dLayerTestUtils.applyAircraftModelMatrix(THREE, matrix, track);

    origin.applyMatrix4(matrix);
    forward.applyMatrix4(matrix).sub(origin);

    // Heading 0 means north — forward should have negative Y (Mercator north) and near-zero X.
    expect(Math.abs(forward.x)).toBeLessThan(Math.abs(forward.y) * 0.01);
    expect(forward.y).toBeLessThan(0);
  });

  it("reuses scratch matrices on the second call", () => {
    const matrix = new THREE.Matrix4();
    const track: RenderableAircraft3dTrack = {
      id: "scratch-reuse",
      lng: 0,
      lat: 0,
      heading: 45,
      altitudeMeters: 5000,
      classKey: "narrow-body"
    };

    aircraft3dLayerTestUtils.applyAircraftModelMatrix(THREE, matrix, track);
    const firstElements = [...matrix.elements];

    aircraft3dLayerTestUtils.applyAircraftModelMatrix(THREE, matrix, track);
    const secondElements = [...matrix.elements];

    expect(firstElements).toEqual(secondElements);
  });

  it("creates all six aircraft class prototypes", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);

    expect(Object.keys(prototypes)).toHaveLength(6);
    for (const key of ["narrow-body", "wide-body", "regional-jet", "bizjet", "prop", "helicopter"] as const) {
      expect(prototypes[key]).toBeInstanceOf(THREE.Group);
      expect(prototypes[key].children.length).toBeGreaterThan(0);
    }
  });

  it("creates prop prototype with a propeller mesh on top of the fixed-wing base", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);
    const prop = prototypes.prop;
    const childNames = prop.children.map((child) => child.name || child.type);

    // A fixed-wing base has fuselage, nose, wings, tailplane, tail-fin — prop adds one more mesh.
    expect(prop.children.length).toBeGreaterThanOrEqual(6);
    expect(childNames).toContain("fuselage");
    expect(childNames).toContain("nose");
  });

  it("creates helicopter prototype with cockpit, boom, and rotor meshes", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);
    const helicopter = prototypes.helicopter;

    // Helicopter has cockpit, boom, skids, skidStruts, skidStrutsRight, rotor, rotorCross, tailRotor, tailRotorCross.
    expect(helicopter.children.length).toBeGreaterThanOrEqual(9);
  });

  it("creates bizjet prototype as a smaller fixed-wing mesh", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);
    const bizjet = prototypes.bizjet;
    const narrowBody = prototypes["narrow-body"];

    expect(bizjet.children.length).toBe(narrowBody.children.length);
    expect(bizjet.getObjectByName("fuselage")).toBeTruthy();
  });

  it("removes stale objects during sync", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);
    const scene = new THREE.Scene();
    const objects = new Map<string, THREE.Group>();
    const trackA: RenderableAircraft3dTrack = {
      id: "a",
      lng: 0,
      lat: 0,
      heading: 0,
      altitudeMeters: 10000,
      classKey: "narrow-body"
    };
    const trackB: RenderableAircraft3dTrack = {
      id: "b",
      lng: 1,
      lat: 1,
      heading: 180,
      altitudeMeters: 8000,
      classKey: "wide-body"
    };

    aircraft3dLayerTestUtils.syncAircraftObjects(scene, objects, prototypes, [trackA, trackB]);
    expect(objects.size).toBe(2);
    expect(scene.children.length).toBe(2);

    // Remove trackA by syncing without it.
    aircraft3dLayerTestUtils.syncAircraftObjects(scene, objects, prototypes, [trackB]);
    expect(objects.size).toBe(1);
    expect(objects.has("a")).toBe(false);
    expect(objects.has("b")).toBe(true);
    expect(scene.children.length).toBe(1);
  });

  it("keeps an existing object when the class key stays the same", () => {
    const prototypes = aircraft3dLayerTestUtils.createAircraftMeshPrototypes(THREE);
    const scene = new THREE.Scene();
    const objects = new Map<string, THREE.Group>();
    const track: RenderableAircraft3dTrack = {
      id: "same-class",
      lng: 0,
      lat: 0,
      heading: 45,
      altitudeMeters: 10000,
      classKey: "regional-jet"
    };

    aircraft3dLayerTestUtils.syncAircraftObjects(scene, objects, prototypes, [track]);
    const firstInstance = objects.get(track.id);

    aircraft3dLayerTestUtils.syncAircraftObjects(scene, objects, prototypes, [track]);
    const secondInstance = objects.get(track.id);

    expect(secondInstance).toBe(firstInstance);
  });
});
