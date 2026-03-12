import type { Bbox, LiveTrack } from "./trafficTypes";

const MPS_TO_KNOTS = 1.94384;

export function openSkyUrl(bbox: Bbox): string {
  const [west, south, east, north] = bbox;
  return (
    "https://opensky-network.org/api/states/all" +
    `?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`
  );
}

export function parseOpenSkyStates(data: unknown, now: number = Date.now()): LiveTrack[] {
  if (typeof data !== "object" || data === null) {
    return [];
  }

  const states = (data as { states?: unknown }).states;
  if (!Array.isArray(states)) {
    return [];
  }

  const tracks: LiveTrack[] = [];
  for (const state of states) {
    if (!Array.isArray(state)) {
      continue;
    }

    const lng = state[5];
    const lat = state[6];
    if (typeof lng !== "number" || typeof lat !== "number") {
      continue;
    }

    const velocityMps = typeof state[9] === "number" ? state[9] : null;
    const callsign = typeof state[1] === "string" ? state[1].trim() : null;

    tracks.push({
      id: typeof state[0] === "string" ? state[0] : `${lng},${lat},${now}`,
      kind: "aircraft",
      lng,
      lat,
      heading: typeof state[10] === "number" ? state[10] : null,
      speedKnots: velocityMps === null ? null : velocityMps * MPS_TO_KNOTS,
      altitudeMeters: typeof state[7] === "number" ? state[7] : null,
      label: callsign || null,
      source: "opensky",
      updatedAt: now
    });
  }

  return tracks;
}
