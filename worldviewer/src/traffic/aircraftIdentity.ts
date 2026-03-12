import {
  deriveRenderModelKey,
  getAircraftIdentityPrefix,
  parseAircraftIdentityShard,
  type AircraftIdentity
} from "./aircraftIdentityData";
import type { LiveTrack } from "./trafficTypes";

export type AircraftIdentityCache = Map<string, Record<string, AircraftIdentity>>;

type AircraftIdentityFetch = typeof fetch;

export function collectAircraftIdentityPrefixes(tracks: LiveTrack[]): string[] {
  const prefixes = new Set<string>();

  for (const track of tracks) {
    if (track.kind !== "aircraft") {
      continue;
    }

    const prefix = getAircraftIdentityPrefix(track.id);
    if (prefix) {
      prefixes.add(prefix);
    }
  }

  return [...prefixes].sort();
}

export function mergeAircraftIdentityIntoTracks(
  tracks: LiveTrack[],
  cache: AircraftIdentityCache
): LiveTrack[] {
  let changed = false;
  const nextTracks = tracks.map((track) => {
    const nextTrack = mergeTrackIdentity(track, cache);
    if (nextTrack !== track) {
      changed = true;
    }

    return nextTrack;
  });

  return changed ? nextTracks : tracks;
}

export class AircraftIdentityStore {
  private readonly cache: AircraftIdentityCache = new Map();
  private readonly failedPrefixes = new Set<string>();
  private readonly loadingPrefixes = new Map<string, Promise<boolean>>();
  private readonly fetchImpl: AircraftIdentityFetch;

  constructor(fetchImpl: AircraftIdentityFetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  mergeTracks(tracks: LiveTrack[]): LiveTrack[] {
    return mergeAircraftIdentityIntoTracks(tracks, this.cache);
  }

  async ensureLoadedForTracks(tracks: LiveTrack[]): Promise<boolean> {
    const loads = collectAircraftIdentityPrefixes(tracks).map((prefix) => this.ensureLoadedForPrefix(prefix));
    if (loads.length === 0) {
      return false;
    }

    const results = await Promise.all(loads);
    return results.some(Boolean);
  }

  private ensureLoadedForPrefix(prefix: string): Promise<boolean> {
    if (this.cache.has(prefix) || this.failedPrefixes.has(prefix)) {
      return Promise.resolve(false);
    }

    const inFlight = this.loadingPrefixes.get(prefix);
    if (inFlight) {
      return inFlight;
    }

    const request = this.loadPrefix(prefix);
    this.loadingPrefixes.set(prefix, request);
    return request;
  }

  private async loadPrefix(prefix: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(buildAircraftIdentityShardUrl(prefix), {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`aircraft identity shard ${prefix} returned ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      this.cache.set(prefix, parseAircraftIdentityShard(payload));
      return true;
    } catch (error) {
      this.failedPrefixes.add(prefix);
      console.warn(`[aircraft-identity] shard ${prefix} failed:`, error);
      return false;
    } finally {
      this.loadingPrefixes.delete(prefix);
    }
  }
}

export function buildAircraftIdentityShardUrlFromBase(
  prefix: string,
  baseUrl: string,
  currentUrl: string | undefined
): string {
  const resolvedCurrentUrl = normalizeBaseResolutionCurrentUrl(baseUrl, currentUrl ?? "http://localhost/");
  const resolvedBaseUrl = new URL(baseUrl, resolvedCurrentUrl);
  return new URL(`aircraft-identity/${prefix}.json`, resolvedBaseUrl).toString();
}

export function buildAircraftIdentityShardUrl(prefix: string): string {
  return buildAircraftIdentityShardUrlFromBase(prefix, import.meta.env.BASE_URL, getCurrentLocationUrl());
}

function mergeTrackIdentity(track: LiveTrack, cache: AircraftIdentityCache): LiveTrack {
  if (track.kind !== "aircraft") {
    return track;
  }

  const prefix = getAircraftIdentityPrefix(track.id);
  if (!prefix) {
    return track;
  }

  const identity = cache.get(prefix)?.[track.id.toLowerCase()];
  if (!identity) {
    return track;
  }

  const aircraftTypeCode = identity.typeCode ?? track.aircraftTypeCode ?? null;
  const registration = identity.registration ?? track.registration ?? null;
  const manufacturer = identity.manufacturer ?? track.manufacturer ?? null;
  const model = identity.model ?? track.model ?? null;
  const renderModelKey = deriveRenderModelKey(aircraftTypeCode);

  if (
    aircraftTypeCode === (track.aircraftTypeCode ?? null) &&
    registration === (track.registration ?? null) &&
    manufacturer === (track.manufacturer ?? null) &&
    model === (track.model ?? null) &&
    renderModelKey === (track.renderModelKey ?? null)
  ) {
    return track;
  }

  return {
    ...track,
    aircraftTypeCode,
    registration,
    manufacturer,
    model,
    renderModelKey
  };
}

function getCurrentLocationUrl(): string | undefined {
  if (typeof document === "object" && typeof document.baseURI === "string") {
    return document.baseURI;
  }

  // Fall back to a synthetic browser location in test environments without a global location.
  if (typeof location === "object" && typeof location.href === "string") {
    return location.href;
  }

  if (typeof location === "object" && typeof location.origin === "string") {
    return `${location.origin}/`;
  }

  return undefined;
}

function normalizeBaseResolutionCurrentUrl(baseUrl: string, currentUrl: string): string {
  if (!isRelativeBaseUrl(baseUrl)) {
    return currentUrl;
  }

  const resolvedCurrentUrl = new URL(currentUrl);
  if (resolvedCurrentUrl.pathname.endsWith("/")) {
    return resolvedCurrentUrl.toString();
  }

  const lastPathSegment = resolvedCurrentUrl.pathname.split("/").pop() ?? "";
  if (isHtmlDocumentPath(lastPathSegment)) {
    return resolvedCurrentUrl.toString();
  }

  resolvedCurrentUrl.pathname = `${resolvedCurrentUrl.pathname}/`;
  return resolvedCurrentUrl.toString();
}

function isRelativeBaseUrl(baseUrl: string): boolean {
  return !baseUrl.startsWith("/") && !baseUrl.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(baseUrl);
}

function isHtmlDocumentPath(pathSegment: string): boolean {
  const normalized = pathSegment.toLowerCase();
  return normalized.endsWith(".html") || normalized.endsWith(".htm");
}
