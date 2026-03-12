import type { Bbox, LiveTrack } from "../trafficModel";

const MPS_TO_KNOTS = 1.94384;

export type OpenSkyParams = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

/** Convert canonical [west, south, east, north] to OpenSky query params. */
export function bboxToOpenSkyParams(bbox: Bbox): OpenSkyParams {
  return {
    lamin: bbox[1],
    lomin: bbox[0],
    lamax: bbox[3],
    lomax: bbox[2],
  };
}

/**
 * Parse OpenSky /states/all response into LiveTrack[].
 * Skips entries that lack a valid position.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseOpenSkyStates(data: any, now: number = Date.now()): LiveTrack[] {
  if (!data?.states) return [];

  const tracks: LiveTrack[] = [];
  for (const s of data.states) {
    const lng = s[5];
    const lat = s[6];
    if (typeof lng !== "number" || typeof lat !== "number") continue;

    const velocityMps = typeof s[9] === "number" ? s[9] : null;
    const callsign = typeof s[1] === "string" ? s[1].trim() : null;

    tracks.push({
      id: s[0],
      kind: "aircraft",
      lng,
      lat,
      heading: typeof s[10] === "number" ? s[10] : null,
      speedKnots: velocityMps !== null ? velocityMps * MPS_TO_KNOTS : null,
      altitudeMeters: typeof s[7] === "number" ? s[7] : null,
      label: callsign || null,
      source: "opensky",
      updatedAt: now,
    });
  }
  return tracks;
}

/** Build the OpenSky REST URL for a bounding box query. */
export function openSkyUrl(bbox: Bbox): string {
  const p = bboxToOpenSkyParams(bbox);
  return (
    `https://opensky-network.org/api/states/all` +
    `?lamin=${p.lamin}&lomin=${p.lomin}&lamax=${p.lamax}&lomax=${p.lomax}`
  );
}
