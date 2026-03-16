/**
 * Flight Route Display — great-circle arc rendering and route lookup for aircraft popups.
 *
 * Pure geodesic math (interpolateGreatCircle) is tested independently.
 * OpenSky route API fetch is wrapped with AbortController support and graceful error handling.
 */

import type { Map as MaplibreMap } from "maplibre-gl";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FLIGHT_ROUTE_SOURCE = "flight-route";
export const FLIGHT_ROUTE_LAYER = "flight-route-line";

const OPENSKY_ROUTE_API = "https://opensky-network.org/api/routes";

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: []
};

// ---------------------------------------------------------------------------
// Great-circle interpolation
// ---------------------------------------------------------------------------

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Compute intermediate points along a great-circle arc between `start` and `end`.
 *
 * Uses the spherical intermediate-point formula (Sinnott).
 * Coordinates are [lng, lat] in decimal degrees.
 *
 * @param start  [lng, lat] start point
 * @param end    [lng, lat] end point
 * @param numPoints  total number of points to return (including endpoints), default 64
 * @returns array of [lng, lat] coordinate pairs
 */
export function interpolateGreatCircle(
  start: [number, number],
  end: [number, number],
  numPoints: number = 64
): [number, number][] {
  const lat1 = start[1] * DEG_TO_RAD;
  const lng1 = start[0] * DEG_TO_RAD;
  const lat2 = end[1] * DEG_TO_RAD;
  const lng2 = end[0] * DEG_TO_RAD;

  // Central angle via Haversine
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const d = 2 * Math.asin(Math.sqrt(a));

  // Same point or negligible distance
  if (d < 1e-10) {
    return [[start[0], start[1]]];
  }

  const points: [number, number][] = [];
  const segments = Math.max(1, numPoints - 1);

  for (let i = 0; i <= segments; i++) {
    const f = i / segments;

    const sinD = Math.sin(d);
    const A = Math.sin((1 - f) * d) / sinD;
    const B = Math.sin(f * d) / sinD;

    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);

    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD_TO_DEG;
    const lng = Math.atan2(y, x) * RAD_TO_DEG;

    points.push([lng, lat]);
  }

  return points;
}

// ---------------------------------------------------------------------------
// Airport coordinates (top ~200 busiest airports worldwide)
// ---------------------------------------------------------------------------

/** Map of ICAO codes to [lat, lng] for the busiest airports worldwide. */
const AIRPORT_COORDS: ReadonlyMap<string, [number, number]> = new Map<string, [number, number]>([
  // North America
  ["KATL", [33.64, -84.43]],
  ["KLAX", [33.94, -118.41]],
  ["KORD", [41.97, -87.91]],
  ["KDFW", [32.90, -97.04]],
  ["KDEN", [39.86, -104.67]],
  ["KJFK", [40.64, -73.78]],
  ["KSFO", [37.62, -122.38]],
  ["KSEA", [47.45, -122.31]],
  ["KLAS", [36.08, -115.15]],
  ["KMCO", [28.43, -81.31]],
  ["KEWR", [40.69, -74.17]],
  ["KMSP", [44.88, -93.22]],
  ["KBOS", [42.37, -71.02]],
  ["KDTW", [42.21, -83.35]],
  ["KPHL", [39.87, -75.24]],
  ["KLGA", [40.78, -73.87]],
  ["KFLL", [26.07, -80.15]],
  ["KBWI", [39.18, -76.67]],
  ["KDCA", [38.85, -77.04]],
  ["KSLC", [40.79, -111.98]],
  ["KIAH", [29.98, -95.34]],
  ["KSAN", [32.73, -117.19]],
  ["KTPA", [27.98, -82.53]],
  ["KPDX", [45.59, -122.60]],
  ["KSTL", [38.75, -90.37]],
  ["KBNA", [36.13, -86.68]],
  ["KAUS", [30.19, -97.67]],
  ["KMIA", [25.79, -80.29]],
  ["KHOU", [29.65, -95.28]],
  ["KMDK", [39.17, -76.67]],
  ["KPIT", [40.50, -80.23]],
  ["KRDU", [35.88, -78.79]],
  ["KCLT", [35.21, -80.94]],
  ["KPHX", [33.44, -112.01]],
  ["KMEM", [35.04, -89.98]],
  ["KCLE", [41.41, -81.85]],
  ["KMKE", [42.95, -87.90]],
  ["KIND", [39.72, -86.29]],
  ["KCVG", [39.05, -84.66]],
  ["KSMF", [38.70, -121.59]],
  // Canada
  ["CYYZ", [43.68, -79.63]],
  ["CYVR", [49.19, -123.18]],
  ["CYUL", [45.47, -73.74]],
  ["CYOW", [45.32, -75.67]],
  ["CYYC", [51.11, -114.02]],
  // Mexico
  ["MMMX", [19.44, -99.07]],
  ["MMUN", [21.04, -86.87]],
  // Europe — UK & Ireland
  ["EGLL", [51.47, -0.46]],
  ["EGKK", [51.15, -0.18]],
  ["EGSS", [51.89, 0.24]],
  ["EGGW", [51.87, -0.37]],
  ["EGCC", [53.35, -2.27]],
  ["EGBB", [52.45, -1.75]],
  ["EGPH", [55.95, -3.37]],
  ["EIDW", [53.42, -6.27]],
  // Europe — Western
  ["LFPG", [49.01, 2.55]],
  ["LFPO", [48.72, 2.36]],
  ["EHAM", [52.31, 4.76]],
  ["EDDF", [50.03, 8.57]],
  ["EDDM", [48.35, 11.79]],
  ["EDDB", [52.36, 13.51]],
  ["EDDL", [51.29, 6.77]],
  ["EDDH", [53.63, 9.99]],
  ["LSZH", [47.46, 8.55]],
  ["LOWW", [48.11, 16.57]],
  ["EBBR", [50.90, 4.48]],
  ["LFML", [43.44, 5.21]],
  ["LFLL", [45.73, 5.08]],
  ["LFMN", [43.66, 7.22]],
  ["LFBD", [44.83, -0.72]],
  // Europe — Southern
  ["LEMD", [40.47, -3.56]],
  ["LEBL", [41.30, 2.08]],
  ["LEPA", [39.55, 2.74]],
  ["LPPT", [38.77, -9.13]],
  ["LIRF", [41.80, 12.24]],
  ["LIMC", [45.63, 8.72]],
  ["LIPZ", [45.51, 12.35]],
  ["LGAV", [37.94, 23.94]],
  ["LTFM", [41.28, 28.74]],
  ["LTBA", [40.98, 28.82]],
  ["LTAI", [36.90, 30.80]],
  // Europe — Northern & Eastern
  ["EKCH", [55.62, 12.66]],
  ["ESSA", [59.65, 17.94]],
  ["ENGM", [60.19, 11.10]],
  ["EFHK", [60.32, 24.96]],
  ["EPWA", [52.17, 20.97]],
  ["LKPR", [50.10, 14.26]],
  ["LHBP", [47.44, 19.26]],
  ["LROP", [44.57, 26.09]],
  // Middle East
  ["OMDB", [25.25, 55.36]],
  ["OMDW", [24.90, 55.16]],
  ["OMAA", [24.44, 54.65]],
  ["OTHH", [25.27, 51.61]],
  ["OEJN", [21.67, 39.16]],
  ["OERK", [24.96, 46.70]],
  ["OBBI", [26.27, 50.64]],
  ["LLBG", [32.01, 34.89]],
  ["OLBA", [33.82, 35.49]],
  ["OIIE", [35.42, 51.15]],
  // Asia — East
  ["ZBAD", [39.51, 116.41]],
  ["ZBAA", [40.08, 116.58]],
  ["ZSPD", [31.14, 121.81]],
  ["ZSSS", [31.20, 121.34]],
  ["ZGGG", [23.39, 113.30]],
  ["ZGSZ", [22.64, 113.81]],
  ["ZUUU", [30.58, 103.95]],
  ["ZPPP", [25.10, 102.74]],
  ["VHHH", [22.31, 113.91]],
  ["RCTP", [25.08, 121.23]],
  ["RKSI", [37.46, 126.44]],
  ["RKSS", [37.56, 126.79]],
  ["RJTT", [35.55, 139.78]],
  ["RJAA", [35.77, 140.39]],
  ["RJBB", [34.43, 135.24]],
  ["RJCC", [42.78, 141.69]],
  ["RJFF", [33.59, 130.45]],
  // Asia — Southeast
  ["WSSS", [1.36, 103.99]],
  ["WMKK", [2.75, 101.71]],
  ["VTBS", [13.69, 100.75]],
  ["VTBD", [13.91, 100.61]],
  ["VVNB", [21.22, 105.81]],
  ["VVTS", [10.82, 106.65]],
  ["RPLL", [14.51, 121.02]],
  ["WIII", [6.13, 106.66]],
  ["WADD", [-8.75, 115.17]],
  // Asia — South
  ["VIDP", [28.57, 77.10]],
  ["VABB", [19.09, 72.87]],
  ["VOBL", [13.20, 77.71]],
  ["VECC", [22.65, 88.45]],
  ["VOMM", [12.99, 80.17]],
  ["OPKC", [24.91, 67.16]],
  ["OPLA", [31.52, 74.40]],
  ["VRMM", [4.19, 73.53]],
  ["VCBI", [7.18, 79.88]],
  // Oceania
  ["YSSY", [-33.95, 151.18]],
  ["YMML", [-37.67, 144.84]],
  ["YBBN", [-27.38, 153.12]],
  ["YPPH", [-31.94, 115.97]],
  ["NZAA", [-37.01, 174.79]],
  ["NZCH", [-43.49, 172.53]],
  // Africa
  ["FAOR", [-26.14, 28.24]],
  ["FACT", [-33.97, 18.60]],
  ["HECA", [30.12, 31.41]],
  ["GMMN", [33.37, -7.59]],
  ["DNMM", [6.58, 3.32]],
  ["HKJK", [-1.32, 36.93]],
  ["HAAB", [8.98, 38.80]],
  ["DTTA", [36.85, 10.23]],
  ["DAAG", [36.69, 3.22]],
  ["FMMI", [-18.80, 47.48]],
  // South America
  ["SBGR", [-23.43, -46.47]],
  ["SBGL", [-22.81, -43.25]],
  ["SCEL", [-33.39, -70.79]],
  ["SKBO", [4.70, -74.15]],
  ["SEQM", [-0.13, -78.36]],
  ["SPJC", [-12.02, -77.11]],
  ["SABE", [-34.56, -58.42]],
  ["SAEZ", [-34.82, -58.54]],
  ["SBKP", [-23.01, -47.13]],
  ["SVMI", [10.60, -66.99]],
  ["SUMU", [-34.84, -56.03]],
  // Central America & Caribbean
  ["MPTO", [9.07, -79.38]],
  ["MROC", [9.99, -84.21]],
  ["TNCM", [18.04, -63.11]],
  ["TJSJ", [18.44, -66.00]],
  ["MKJP", [17.94, -76.79]],
  // Russia & Central Asia
  ["UUEE", [55.97, 37.41]],
  ["UUDD", [55.41, 37.91]],
  ["ULLI", [59.80, 30.26]],
  ["UAAA", [43.35, 77.04]],
  ["UTTT", [41.26, 69.28]],
]);

/**
 * Look up airport coordinates by ICAO code.
 * Returns `{ lng, lat }` or `null` if the airport is not in the dataset.
 */
export function lookupAirportCoords(icao: string): { lng: number; lat: number } | null {
  const entry = AIRPORT_COORDS.get(icao.toUpperCase());
  if (!entry) return null;
  return { lat: entry[0], lng: entry[1] };
}

// ---------------------------------------------------------------------------
// OpenSky route API
// ---------------------------------------------------------------------------

/**
 * Fetch the flight route (origin + destination ICAO codes) from the OpenSky Network route API.
 * Returns null on any error, 404, malformed response, or abort.
 */
export async function fetchFlightRoute(
  callsign: string,
  signal?: AbortSignal
): Promise<{ origin: string; destination: string } | null> {
  try {
    const url = `${OPENSKY_ROUTE_API}?callsign=${encodeURIComponent(callsign)}`;
    const response = await fetch(url, { signal });

    if (!response.ok) {
      return null;
    }

    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null) return null;

    const record = data as Record<string, unknown>;
    if (!Array.isArray(record.route) || record.route.length < 2) {
      return null;
    }

    const origin = record.route[0];
    const destination = record.route[record.route.length - 1];

    if (typeof origin !== "string" || typeof destination !== "string") {
      return null;
    }

    return { origin, destination };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route resolution pipeline
// ---------------------------------------------------------------------------

export type FlightRouteResult = {
  origin: { icao: string; lng: number; lat: number };
  destination: { icao: string; lng: number; lat: number };
  arc: [number, number][];
};

/**
 * Full pipeline: fetch route, resolve airport coords, compute great-circle arc.
 * Returns null if any step fails.
 */
export async function resolveFlightRoute(
  callsign: string,
  signal?: AbortSignal
): Promise<FlightRouteResult | null> {
  const route = await fetchFlightRoute(callsign, signal);
  if (!route) return null;

  const origin = lookupAirportCoords(route.origin);
  const destination = lookupAirportCoords(route.destination);
  if (!origin || !destination) return null;

  const arc = interpolateGreatCircle(
    [origin.lng, origin.lat],
    [destination.lng, destination.lat],
    64
  );

  return {
    origin: { icao: route.origin, ...origin },
    destination: { icao: route.destination, ...destination },
    arc
  };
}

// ---------------------------------------------------------------------------
// In-memory route cache (per session)
// ---------------------------------------------------------------------------

const routeCache = new Map<string, FlightRouteResult | null>();

/**
 * Cached version of resolveFlightRoute — avoids redundant API calls for the same callsign.
 */
export async function resolveFlightRouteCached(
  callsign: string,
  signal?: AbortSignal
): Promise<FlightRouteResult | null> {
  const key = callsign.toUpperCase().trim();
  if (routeCache.has(key)) {
    return routeCache.get(key) ?? null;
  }

  const result = await resolveFlightRoute(callsign, signal);
  routeCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// MapLibre layer management
// ---------------------------------------------------------------------------

/** Add the flight-route GeoJSON source and line layer. Call once during addTrafficLayers. */
export function addFlightRouteLayer(map: MaplibreMap): void {
  map.addSource(FLIGHT_ROUTE_SOURCE, {
    type: "geojson",
    data: EMPTY_FC
  });

  map.addLayer({
    id: FLIGHT_ROUTE_LAYER,
    type: "line",
    source: FLIGHT_ROUTE_SOURCE,
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#a78bfa",
      "line-width": 2,
      "line-dasharray": [4, 3],
      "line-opacity": 0.7
    }
  });
}

/** Render a great-circle arc on the map. */
export function showFlightRoute(map: MaplibreMap, arc: [number, number][]): void {
  const source = map.getSource(FLIGHT_ROUTE_SOURCE);
  if (!source || !("setData" in source)) return;

  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: arc
        },
        properties: {}
      }
    ]
  };

  (source as { setData(data: GeoJSON.FeatureCollection): void }).setData(fc);
}

/** Clear the flight route from the map. */
export function clearFlightRoute(map: MaplibreMap): void {
  const source = map.getSource(FLIGHT_ROUTE_SOURCE);
  if (!source || !("setData" in source)) return;
  (source as { setData(data: GeoJSON.FeatureCollection): void }).setData(EMPTY_FC);
}
