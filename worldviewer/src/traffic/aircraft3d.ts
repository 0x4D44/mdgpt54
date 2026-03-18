import { normalizeAircraftIdentityText, normalizeAircraftTypeCode } from "./aircraftIdentityData";
import { AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX } from "./aircraftIconSizing";
import type { Bbox, LiveTrack } from "./trafficTypes";

export type Aircraft3dClassKey =
  | "narrow-body"
  | "wide-body"
  | "regional-jet"
  | "bizjet"
  | "prop"
  | "helicopter";

export type RenderableAircraft3dTrack = {
  id: string;
  lng: number;
  lat: number;
  heading: number | null;
  altitudeMeters: number;
  classKey: Aircraft3dClassKey;
};

export type Aircraft3dModeDecision = {
  enabled: boolean;
  visibleRenderableCount: number;
};

export type Aircraft3dModeInput = {
  zoom: number;
  pitch: number;
  visibleRenderableCount: number;
};

type Aircraft3dView = {
  bounds: Bbox;
  zoom: number;
  pitch: number;
  tracks: LiveTrack[];
};

// Meter-true aircraft remain unreadably small at mid zooms, so keep the 2D symbols
// until the camera is close enough for the 3D handoff to read clearly.
const AIRCRAFT_3D_ON_ZOOM = 13.5;
const AIRCRAFT_3D_OFF_ZOOM = 13;
const AIRCRAFT_3D_ON_PITCH = 45;
const AIRCRAFT_3D_OFF_PITCH = 35;
const AIRCRAFT_3D_ON_COUNT = 24;
const AIRCRAFT_3D_OFF_COUNT = 32;
// Match the capped 2D aircraft symbol size so 3D never replaces it with a much
// smaller meter-true mesh at handoff.
const AIRCRAFT_3D_MIN_HANDOFF_SIZE_PX = AIRCRAFT_2D_SYMBOL_MAX_SIZE_PX;
const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const WEB_MERCATOR_WORLD_SIZE_AT_ZOOM_0 = 512;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.68557849;
const AIRCRAFT_3D_CLASS_MAJOR_AXIS_METERS: Record<Aircraft3dClassKey, number> = {
  "narrow-body": 38,
  "wide-body": 60,
  "regional-jet": 28,
  bizjet: 20,
  prop: 17,
  helicopter: 16
};

const MODEL_KEY_CLASS_MAP: Record<string, Aircraft3dClassKey> = {
  "airbus-a320-family": "narrow-body",
  "boeing-737-family": "narrow-body",
  "boeing-777-family": "wide-body",
  "boeing-787-family": "wide-body"
};

const NARROW_BODY_PREFIXES = ["A318", "A319", "A320", "A321", "A20N", "A21N", "B73", "B37", "B38", "B39"];
const WIDE_BODY_PREFIXES = ["A330", "A332", "A333", "A339", "A340", "A350", "A359", "A35K", "A380", "B74", "B76", "B77", "B78", "B79", "MD11", "DC10"];
const REGIONAL_JET_PREFIXES = ["CRJ", "E17", "E18", "E19", "E2", "BCS", "A220", "SU95", "ARJ"];
const HELICOPTER_PREFIXES = ["R22", "R44", "R66", "EC35", "EC45", "A139", "B06", "B407", "B429", "S76"];
const BIZJET_PREFIXES = [
  "C25",
  "C500",
  "C510",
  "C525",
  "C550",
  "C560",
  "C56X",
  "C650",
  "C680",
  "C700",
  "C750",
  "CL3",
  "CL6",
  "E35",
  "E45",
  "E50",
  "E55",
  "E75S",
  "FA",
  "GL",
  "H25",
  "LJ",
  "PRM",
  "BE40"
];
const PROP_PREFIXES = ["AT", "DH8", "DHC", "C208", "C206", "C130", "C402", "PC12", "BE20", "BE9L", "JS3", "L410", "SF34", "SW4"];
const HELICOPTER_KEYWORDS = ["helicopter", "rotor", "bell", "robinson", "sikorsky", "ec135", "ec145", "as350", "aw139"];
const BIZJET_KEYWORDS = ["citation", "gulfstream", "learjet", "challenger", "falcon", "phenom", "hawker"];
const PROP_KEYWORDS = ["atr", "dash 8", "dash-8", "king air", "caravan", "turboprop", "pilatus pc-12"];
const REGIONAL_JET_KEYWORDS = ["embraer 170", "embraer 175", "embraer 190", "embraer 195", "crj", "a220", "cseries"];
const WIDE_BODY_KEYWORDS = ["787", "777", "767", "747", "330", "340", "350", "380", "md-11", "dc-10"];
const NARROW_BODY_KEYWORDS = ["737", "a318", "a319", "a320", "a321", "a20n", "a21n"];

export function resolveAircraft3dMode(
  previousEnabled: boolean,
  view: Aircraft3dView
): Aircraft3dModeDecision {
  const visibleRenderableCount = buildRenderableAircraft3dTracks(view.tracks, view.bounds).length;
  return resolveAircraft3dModeFromVisibleCount(previousEnabled, {
    zoom: view.zoom,
    pitch: view.pitch,
    visibleRenderableCount
  });
}

export function resolveAircraft3dModeFromVisibleCount(
  previousEnabled: boolean,
  input: Aircraft3dModeInput
): Aircraft3dModeDecision {
  if (previousEnabled) {
    return {
      enabled:
        !(
          input.zoom < AIRCRAFT_3D_OFF_ZOOM ||
          input.pitch < AIRCRAFT_3D_OFF_PITCH ||
          input.visibleRenderableCount >= AIRCRAFT_3D_OFF_COUNT
        ),
      visibleRenderableCount: input.visibleRenderableCount
    };
  }

  return {
    enabled:
      input.zoom >= AIRCRAFT_3D_ON_ZOOM &&
      input.pitch >= AIRCRAFT_3D_ON_PITCH &&
      input.visibleRenderableCount <= AIRCRAFT_3D_ON_COUNT,
    visibleRenderableCount: input.visibleRenderableCount
  };
}

export function buildRenderableAircraft3dTracks(
  tracks: LiveTrack[],
  bounds: Bbox
): RenderableAircraft3dTrack[] {
  const renderable: RenderableAircraft3dTrack[] = [];

  for (const track of tracks) {
    if (track.kind !== "aircraft" || !isTrackWithinBounds(track, bounds)) {
      continue;
    }

    const altitudeMeters = getAircraft3dAltitudeMeters(track);
    if (altitudeMeters === null) {
      continue;
    }

    renderable.push({
      id: track.id,
      lng: track.lng,
      lat: track.lat,
      heading: track.heading,
      altitudeMeters,
      classKey: selectAircraft3dClass(track)
    });
  }

  return renderable;
}

export function filterAircraft3dHandoffTracks(
  tracks: RenderableAircraft3dTrack[],
  zoom: number
): RenderableAircraft3dTrack[] {
  return tracks.filter((track) => isAircraft3dHandoffTrack(track, zoom));
}

export function isAircraft3dHandoffTrack(
  track: Pick<RenderableAircraft3dTrack, "lat" | "classKey">,
  zoom: number
): boolean {
  return estimateAircraft3dScreenSizePixels(track, zoom) >= AIRCRAFT_3D_MIN_HANDOFF_SIZE_PX;
}

export function getAircraft3dAltitudeMeters(
  track: Pick<LiveTrack, "altitudeMeters" | "geoAltitudeMeters" | "onGround">
): number | null {
  if (track.onGround === true) {
    return null;
  }

  return track.geoAltitudeMeters ?? track.altitudeMeters ?? null;
}

export function selectAircraft3dClass(
  track: Pick<LiveTrack, "renderModelKey" | "aircraftTypeCode" | "aircraftCategory" | "manufacturer" | "model">
): Aircraft3dClassKey {
  const renderModelKey = normalizeAircraftIdentityText(track.renderModelKey)?.toLowerCase();
  if (renderModelKey && renderModelKey in MODEL_KEY_CLASS_MAP) {
    return MODEL_KEY_CLASS_MAP[renderModelKey];
  }

  const typeCode = normalizeAircraftTypeCode(track.aircraftTypeCode);
  if (typeCode) {
    if (matchesAnyPrefix(typeCode, WIDE_BODY_PREFIXES)) {
      return "wide-body";
    }
    if (matchesAnyPrefix(typeCode, NARROW_BODY_PREFIXES)) {
      return "narrow-body";
    }
    if (matchesAnyPrefix(typeCode, REGIONAL_JET_PREFIXES)) {
      return "regional-jet";
    }
    if (matchesAnyPrefix(typeCode, HELICOPTER_PREFIXES)) {
      return "helicopter";
    }
    if (matchesAnyPrefix(typeCode, BIZJET_PREFIXES)) {
      return "bizjet";
    }
    if (matchesAnyPrefix(typeCode, PROP_PREFIXES)) {
      return "prop";
    }
  }

  const descriptor = buildDescriptor(track.manufacturer, track.model);
  if (descriptor) {
    if (includesAnyKeyword(descriptor, HELICOPTER_KEYWORDS)) {
      return "helicopter";
    }
    if (includesAnyKeyword(descriptor, WIDE_BODY_KEYWORDS)) {
      return "wide-body";
    }
    if (includesAnyKeyword(descriptor, NARROW_BODY_KEYWORDS)) {
      return "narrow-body";
    }
    if (includesAnyKeyword(descriptor, REGIONAL_JET_KEYWORDS)) {
      return "regional-jet";
    }
    if (includesAnyKeyword(descriptor, BIZJET_KEYWORDS)) {
      return "bizjet";
    }
    if (includesAnyKeyword(descriptor, PROP_KEYWORDS)) {
      return "prop";
    }
  }

  switch (track.aircraftCategory) {
    case 5:
    case 6:
      return "wide-body";
    case 4:
      return "narrow-body";
    case 7:
      return "bizjet";
    case 8:
      return "helicopter";
    case 2:
    case 3:
    case 9:
    case 10:
    case 11:
    case 12:
      return "prop";
    default:
      return "narrow-body";
  }
}

function isTrackWithinBounds(track: Pick<LiveTrack, "lng" | "lat">, bounds: Bbox): boolean {
  const [west, south, east, north] = bounds;
  if (track.lat < south || track.lat > north) {
    return false;
  }

  if (west <= east) {
    return track.lng >= west && track.lng <= east;
  }

  return track.lng >= west || track.lng <= east;
}

function matchesAnyPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function buildDescriptor(manufacturer: string | null | undefined, model: string | null | undefined): string | null {
  const normalizedManufacturer = normalizeAircraftIdentityText(manufacturer);
  const normalizedModel = normalizeAircraftIdentityText(model);
  const combined = [normalizedManufacturer, normalizedModel].filter(Boolean).join(" ").toLowerCase();
  return combined.length > 0 ? combined : null;
}

function includesAnyKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function estimateAircraft3dScreenSizePixels(
  track: Pick<RenderableAircraft3dTrack, "lat" | "classKey">,
  zoom: number
): number {
  return AIRCRAFT_3D_CLASS_MAJOR_AXIS_METERS[track.classKey] / getMercatorMetersPerPixel(track.lat, zoom);
}

function getMercatorMetersPerPixel(lat: number, zoom: number): number {
  const clampedLat = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, lat));
  const latitudeScale = Math.cos((clampedLat * Math.PI) / 180);
  return (EARTH_CIRCUMFERENCE_METERS * latitudeScale) / (WEB_MERCATOR_WORLD_SIZE_AT_ZOOM_0 * 2 ** zoom);
}
