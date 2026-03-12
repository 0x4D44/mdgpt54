import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibreMap } from "maplibre-gl";

import {
  buildRenderableAircraft3dTracks,
  resolveAircraft3dModeFromVisibleCount,
  type Aircraft3dClassKey,
  type RenderableAircraft3dTrack
} from "./aircraft3d";
import { bboxFromBounds } from "./trafficHelpers";
import type { LiveTrack } from "./trafficTypes";

type ThreeModule = typeof import("three");
type CustomRenderParameters = Parameters<CustomLayerInterface["render"]>[1];
type VisibilityChangeHandler = () => void;
type ThreeLoader = () => Promise<ThreeModule>;

type AircraftMeshPrototypeMap = Record<Aircraft3dClassKey, import("three").Group>;
type AircraftModelMatrixScratch = {
  heading: import("three").Matrix4;
  scale: import("three").Matrix4;
};

const AIRCRAFT_3D_LAYER_ID = "live-aircraft-3d";
const AIRCRAFT_CLASS_KEY_USER_DATA = "aircraftClassKey";
const EMPTY_HIDDEN_IDS = new Set<string>();
const aircraftModelMatrixScratch = new WeakMap<object, AircraftModelMatrixScratch>();

export class Aircraft3dController {
  private readonly map: MapLibreMap;
  private readonly onVisibilityChange: VisibilityChangeHandler;
  private readonly loadThree: ThreeLoader;
  private latestTracks: LiveTrack[] = [];
  private hiddenTrackIds = EMPTY_HIDDEN_IDS;
  private enabled = false;
  private disposed = false;
  private syncHandle = 0;
  private layer: Aircraft3dRuntimeLayer | null = null;
  private layerLoad: Promise<void> | null = null;
  private threeLoadFailed = false;
  private warnedThreeLoadFailure = false;
  private readonly handleMapMove = () => {
    this.scheduleSync();
  };

  constructor(map: MapLibreMap, onVisibilityChange: VisibilityChangeHandler, loadThree: ThreeLoader = () => import("three")) {
    this.map = map;
    this.onVisibilityChange = onVisibilityChange;
    this.loadThree = loadThree;
    this.map.on("move", this.handleMapMove);
  }

  setTracks(tracks: LiveTrack[]): void {
    this.latestTracks = tracks;
    this.scheduleSync();
  }

  getHiddenTrackIds(): ReadonlySet<string> {
    return this.hiddenTrackIds;
  }

  dispose(): void {
    this.disposed = true;
    if (this.syncHandle !== 0) {
      cancelAnimationFrame(this.syncHandle);
      this.syncHandle = 0;
    }

    this.map.off("move", this.handleMapMove);

    if (this.layer && this.map.getLayer(AIRCRAFT_3D_LAYER_ID)) {
      this.map.removeLayer(AIRCRAFT_3D_LAYER_ID);
    }

    this.layer?.dispose();
    this.layer = null;
    this.hiddenTrackIds = EMPTY_HIDDEN_IDS;
  }

  private scheduleSync(): void {
    if (this.disposed || this.syncHandle !== 0) {
      return;
    }

    this.syncHandle = requestAnimationFrame(() => {
      this.syncHandle = 0;
      this.syncNow();
    });
  }

  private syncNow(): void {
    if (this.disposed) {
      return;
    }

    const renderableTracks = buildRenderableAircraft3dTracks(this.latestTracks, bboxFromBounds(this.map.getBounds()));
    const mode = resolveAircraft3dModeFromVisibleCount(this.enabled, {
      zoom: this.map.getZoom(),
      pitch: this.map.getPitch(),
      visibleRenderableCount: renderableTracks.length
    });
    this.enabled = mode.enabled;

    if (this.enabled && renderableTracks.length > 0) {
      void this.ensureLayer();
    }

    if (this.layer) {
      this.layer.setTracks(this.enabled ? renderableTracks : []);
    }

    this.updateHiddenTrackIds(
      this.enabled && this.layer ? new Set(renderableTracks.map((track) => track.id)) : EMPTY_HIDDEN_IDS
    );
  }

  private async ensureLayer(): Promise<void> {
    if (this.layer || this.layerLoad || this.disposed || this.threeLoadFailed) {
      return this.layerLoad ?? Promise.resolve();
    }

    this.layerLoad = this.loadThree()
      .then((THREE) => {
        if (this.disposed || this.layer) {
          return;
        }

        const layer = new Aircraft3dRuntimeLayer(this.map, THREE);
        this.layer = layer;
        if (!this.map.getLayer(AIRCRAFT_3D_LAYER_ID)) {
          this.map.addLayer(layer);
        }
      })
      .catch((error: unknown) => {
        this.threeLoadFailed = true;
        if (!this.warnedThreeLoadFailure) {
          this.warnedThreeLoadFailure = true;
          console.warn("Aircraft 3D layer unavailable; keeping 2D aircraft visible.", error);
        }
      })
      .finally(() => {
        this.layerLoad = null;
        this.scheduleSync();
      });

    return this.layerLoad;
  }

  private updateHiddenTrackIds(nextIds: ReadonlySet<string>): void {
    if (sameTrackIdSet(this.hiddenTrackIds, nextIds)) {
      return;
    }

    this.hiddenTrackIds = nextIds.size > 0 ? new Set(nextIds) : EMPTY_HIDDEN_IDS;
    this.onVisibilityChange();
  }
}

class Aircraft3dRuntimeLayer implements CustomLayerInterface {
  readonly id = AIRCRAFT_3D_LAYER_ID;
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private readonly map: MapLibreMap;
  private readonly THREE: ThreeModule;
  private readonly scene: import("three").Scene;
  private readonly camera: import("three").Camera;
  private readonly prototypes: AircraftMeshPrototypeMap;
  private readonly objects = new Map<string, import("three").Group>();
  private renderer: import("three").WebGLRenderer | null = null;
  private tracks: RenderableAircraft3dTrack[] = [];

  constructor(map: MapLibreMap, THREE: ThreeModule) {
    this.map = map;
    this.THREE = THREE;
    this.scene = new THREE.Scene();
    this.scene.matrixAutoUpdate = false;
    this.camera = new THREE.Camera();
    this.prototypes = createAircraftMeshPrototypes(THREE);
    addAircraftLights(THREE, this.scene);
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.renderer = new this.THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl
    });
    this.renderer.autoClear = false;
  }

  onRemove(): void {
    this.dispose();
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, { defaultProjectionData }: CustomRenderParameters): void {
    if (!this.renderer) {
      return;
    }

    this.camera.projectionMatrix.fromArray(defaultProjectionData.mainMatrix as ArrayLike<number>);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    for (const track of this.tracks) {
      const object = this.objects.get(track.id);
      if (!object) {
        continue;
      }

      object.visible = true;
      applyAircraftModelMatrix(this.THREE, object.matrix, track);
      object.matrixWorldNeedsUpdate = true;
    }

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  setTracks(tracks: RenderableAircraft3dTrack[]): void {
    this.tracks = tracks;
    syncAircraftObjects(this.scene, this.objects, this.prototypes, this.tracks);
    this.map.triggerRepaint();
  }

  dispose(): void {
    for (const object of this.objects.values()) {
      this.scene.remove(object);
    }
    this.objects.clear();
    disposePrototypes(this.THREE, this.prototypes);
    this.renderer?.dispose();
    this.renderer = null;
  }
}

function syncAircraftObjects(
  scene: import("three").Scene,
  objects: Map<string, import("three").Group>,
  prototypes: AircraftMeshPrototypeMap,
  tracks: RenderableAircraft3dTrack[]
): void {
  const nextIds = new Set<string>();

  for (const track of tracks) {
    nextIds.add(track.id);
    const current = objects.get(track.id);
    const currentClassKey = current?.userData[AIRCRAFT_CLASS_KEY_USER_DATA] as Aircraft3dClassKey | undefined;
    if (current && currentClassKey === track.classKey) {
      continue;
    }

    if (current) {
      scene.remove(current);
      objects.delete(track.id);
    }

    // three.js Mesh.copy shares geometry/material references here, so stale clones only need scene removal.
    const instance = prototypes[track.classKey].clone(true);
    instance.name = track.id;
    instance.matrixAutoUpdate = false;
    instance.frustumCulled = false;
    instance.userData[AIRCRAFT_CLASS_KEY_USER_DATA] = track.classKey;
    setObjectFrustumCulling(instance, false);
    scene.add(instance);
    objects.set(track.id, instance);
  }

  const staleIds: string[] = [];
  for (const [id, object] of objects.entries()) {
    if (nextIds.has(id)) {
      continue;
    }

    scene.remove(object);
    staleIds.push(id);
  }

  for (const id of staleIds) {
    objects.delete(id);
  }
}

function setObjectFrustumCulling(object: import("three").Object3D, enabled: boolean): void {
  object.frustumCulled = enabled;
  object.traverse((child) => {
    child.frustumCulled = enabled;
  });
}

function createAircraftMeshPrototypes(THREE: ThreeModule): AircraftMeshPrototypeMap {
  return {
    "narrow-body": createFixedWingMesh(THREE, {
      fuselageLength: 38,
      fuselageRadius: 1.9,
      wingspan: 34,
      wingChord: 6.2,
      tailSpan: 13,
      color: "#7ed9ff"
    }),
    "wide-body": createFixedWingMesh(THREE, {
      fuselageLength: 60,
      fuselageRadius: 3.1,
      wingspan: 58,
      wingChord: 9.8,
      tailSpan: 20,
      color: "#b1e6ff"
    }),
    "regional-jet": createFixedWingMesh(THREE, {
      fuselageLength: 28,
      fuselageRadius: 1.5,
      wingspan: 24,
      wingChord: 4.8,
      tailSpan: 9,
      color: "#79c4ff"
    }),
    bizjet: createFixedWingMesh(THREE, {
      fuselageLength: 20,
      fuselageRadius: 1.1,
      wingspan: 18,
      wingChord: 3.8,
      tailSpan: 7,
      color: "#ffd27f"
    }),
    prop: createPropMesh(THREE),
    helicopter: createHelicopterMesh(THREE)
  };
}

function createFixedWingMesh(
  THREE: ThreeModule,
  options: {
    fuselageLength: number;
    fuselageRadius: number;
    wingspan: number;
    wingChord: number;
    tailSpan: number;
    color: string;
  }
): import("three").Group {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: options.color,
    metalness: 0.18,
    roughness: 0.54
  });
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: darkenColor(options.color, 0.84),
    metalness: 0.12,
    roughness: 0.62
  });

  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(options.fuselageRadius, options.fuselageRadius, options.fuselageLength, 12),
    bodyMaterial
  );
  fuselage.name = "fuselage";
  group.add(fuselage);

  const noseLength = options.fuselageRadius * 2.2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(options.fuselageRadius, noseLength, 12), bodyMaterial);
  nose.name = "nose";
  nose.position.y = options.fuselageLength / 2 + noseLength / 2;
  group.add(nose);

  const wings = new THREE.Mesh(
    new THREE.BoxGeometry(options.wingspan, options.wingChord, 0.45),
    wingMaterial
  );
  wings.name = "wings";
  wings.position.y = -1;
  wings.rotation.z = THREE.MathUtils.degToRad(3);
  group.add(wings);

  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(options.tailSpan, options.wingChord * 0.45, 0.28), wingMaterial);
  tailplane.name = "tailplane";
  tailplane.position.set(0, -options.fuselageLength / 2 + 4, 0.2);
  group.add(tailplane);

  const tailFin = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, options.wingChord * 0.35, options.fuselageRadius * 3),
    wingMaterial
  );
  tailFin.name = "tail-fin";
  tailFin.position.set(0, -options.fuselageLength / 2 + 3.2, options.fuselageRadius * 1.4);
  group.add(tailFin);

  return group;
}

function createPropMesh(THREE: ThreeModule): import("three").Group {
  const group = createFixedWingMesh(THREE, {
    fuselageLength: 16,
    fuselageRadius: 0.9,
    wingspan: 17,
    wingChord: 3.4,
    tailSpan: 6.6,
    color: "#9cffc7"
  });
  const propMaterial = new THREE.MeshStandardMaterial({
    color: "#f7fafc",
    metalness: 0.08,
    roughness: 0.58
  });
  const propeller = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.22, 0.14), propMaterial);
  propeller.position.set(0, 9.7, 0);
  group.add(propeller);
  return group;
}

function createHelicopterMesh(THREE: ThreeModule): import("three").Group {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: "#ffb49a",
    metalness: 0.16,
    roughness: 0.52
  });
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: "#5f6c80",
    metalness: 0.12,
    roughness: 0.7
  });

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 12), bodyMaterial);
  cockpit.scale.set(1.1, 1.9, 0.9);
  cockpit.position.y = 1.2;
  group.add(cockpit);

  const boom = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 0.9), detailMaterial);
  boom.position.y = -6.5;
  group.add(boom);

  const skids = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.2, 0.2), detailMaterial);
  skids.position.set(0, 0.2, -2.7);
  group.add(skids);

  const skidStruts = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.22), detailMaterial);
  skidStruts.position.set(-2.2, 0.8, -1.4);
  group.add(skidStruts);
  const skidStrutsRight = skidStruts.clone();
  skidStrutsRight.position.x = 2.2;
  group.add(skidStrutsRight);

  const rotor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.18, 0.24), detailMaterial);
  rotor.position.set(0, 1.6, 2.4);
  group.add(rotor);

  const rotorCross = new THREE.Mesh(new THREE.BoxGeometry(0.24, 16, 0.18), detailMaterial);
  rotorCross.position.copy(rotor.position);
  group.add(rotorCross);

  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.16), detailMaterial);
  tailRotor.position.set(0, -12.4, 0);
  group.add(tailRotor);

  const tailRotorCross = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 0.16), detailMaterial);
  tailRotorCross.position.copy(tailRotor.position);
  group.add(tailRotorCross);

  return group;
}

function addAircraftLights(THREE: ThreeModule, scene: import("three").Scene): void {
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.45);
  sunLight.position.set(0.5, 0.9, 1.8);
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0x9cd6ff, 0.35);
  fillLight.position.set(-0.4, -1.2, 0.8);
  scene.add(fillLight);
}

function getAircraftModelMatrixScratch(THREE: ThreeModule): AircraftModelMatrixScratch {
  const cached = aircraftModelMatrixScratch.get(THREE as object);
  if (cached) {
    return cached;
  }

  const created = {
    heading: new THREE.Matrix4(),
    scale: new THREE.Matrix4()
  };
  aircraftModelMatrixScratch.set(THREE as object, created);
  return created;
}

function applyAircraftModelMatrix(
  THREE: ThreeModule,
  target: import("three").Matrix4,
  track: RenderableAircraft3dTrack
): void {
  const mercatorPosition = MercatorCoordinate.fromLngLat([track.lng, track.lat], track.altitudeMeters);
  const mercatorScale = mercatorPosition.meterInMercatorCoordinateUnits();
  const scratch = getAircraftModelMatrixScratch(THREE);

  // Local aircraft meshes use +Y nose-forward and +Z up; negative Mercator Y keeps heading 0 pointing north.
  target
    .makeTranslation(mercatorPosition.x, mercatorPosition.y, mercatorPosition.z)
    .multiply(scratch.heading.makeRotationZ(THREE.MathUtils.degToRad(track.heading ?? 0)))
    .multiply(scratch.scale.makeScale(mercatorScale, -mercatorScale, mercatorScale));
}

function darkenColor(hexColor: string, factor: number): string {
  const color = Number.parseInt(hexColor.replace("#", ""), 16);
  const red = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)));
  const green = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)));
  const blue = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)));
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function disposePrototypes(THREE: ThreeModule, prototypes: AircraftMeshPrototypeMap): void {
  const geometries = new Set<import("three").BufferGeometry>();
  const materials = new Set<import("three").Material>();

  for (const prototype of Object.values(prototypes)) {
    prototype.traverse((child: import("three").Object3D) => {
      const mesh = child as import("three").Mesh;
      if (mesh.geometry instanceof THREE.BufferGeometry) {
        geometries.add(mesh.geometry);
      }

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material: import("three").Material) => materials.add(material));
      } else if (mesh.material instanceof THREE.Material) {
        materials.add(mesh.material);
      }
    });
  }

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function sameTrackIdSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

export const aircraft3dLayerTestUtils = {
  applyAircraftModelMatrix,
  createAircraftMeshPrototypes,
  syncAircraftObjects
};
