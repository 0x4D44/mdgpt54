import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import viteConfig from "../../vite.config";
import {
  AircraftIdentityStore,
  buildAircraftIdentityShardUrl,
  buildAircraftIdentityShardUrlFromBase,
  collectAircraftIdentityPrefixes,
  mergeAircraftIdentityIntoTracks
} from "./aircraftIdentity";
import type { LiveTrack } from "./trafficTypes";

const CURRENT_VITE_BASE_URL = (viteConfig as { base?: string }).base ?? "/";

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

describe("collectAircraftIdentityPrefixes", () => {
  it("deduplicates visible aircraft shard prefixes and ignores non-aircraft tracks", () => {
    expect(
      collectAircraftIdentityPrefixes([
        makeTrack({ id: "abc123" }),
        makeTrack({ id: "a0c123" }),
        makeTrack({ id: "f0c123" }),
        {
          ...makeTrack({ id: "ship-1" }),
          kind: "ship"
        },
        makeTrack({ id: "not-hex" })
      ])
    ).toEqual(["a0", "ab", "f0"]);
  });
});

describe("mergeAircraftIdentityIntoTracks", () => {
  it("merges cached identity fields into visible aircraft tracks", () => {
    const cache = new Map([
      [
        "ab",
        {
          abc123: {
            registration: "N123AB",
            typeCode: "B738",
            manufacturer: "Boeing",
            model: "737-800"
          }
        }
      ]
    ]);

    expect(mergeAircraftIdentityIntoTracks([makeTrack()], cache)).toEqual([
      makeTrack({
        aircraftTypeCode: "B738",
        manufacturer: "Boeing",
        model: "737-800",
        registration: "N123AB",
        renderModelKey: "boeing-737-family"
      })
    ]);
  });

  it("passes through non-aircraft tracks without merging", () => {
    const shipTrack: LiveTrack = { ...makeTrack({ id: "ship-1" }), kind: "ship" };
    const cache = new Map([
      ["ab", { abc123: { registration: "N123AB", typeCode: "B738", manufacturer: "Boeing", model: "737-800" } }]
    ]);
    const result = mergeAircraftIdentityIntoTracks([shipTrack], cache);
    expect(result).toBe(result);
    expect(result[0]).toBe(shipTrack);
  });

  it("passes through aircraft with invalid icao24 without merging", () => {
    const track = makeTrack({ id: "not-hex" });
    const cache = new Map([
      ["ab", { abc123: { registration: "N123AB", typeCode: "B738", manufacturer: "Boeing", model: "737-800" } }]
    ]);
    const result = mergeAircraftIdentityIntoTracks([track], cache);
    expect(result[0]).toBe(track);
  });

  it("returns the original track when identity fields already match", () => {
    const track = makeTrack({
      aircraftTypeCode: "B738",
      registration: "N123AB",
      manufacturer: "Boeing",
      model: "737-800",
      renderModelKey: "boeing-737-family"
    });
    const cache = new Map([
      [
        "ab",
        {
          abc123: {
            registration: "N123AB",
            typeCode: "B738",
            manufacturer: "Boeing",
            model: "737-800"
          }
        }
      ]
    ]);
    const result = mergeAircraftIdentityIntoTracks([track], cache);
    expect(result).toBe(result);
    expect(result[0]).toBe(track);
  });
});

describe("AircraftIdentityStore", () => {
  beforeEach(() => {
    vi.stubEnv("BASE_URL", "/");
    vi.stubGlobal("location", {
      origin: "http://localhost:5173",
      href: "http://localhost:5173/"
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads a visible shard once per session and reuses it for later merges", async () => {
    const fetchCalls: Array<RequestInfo | URL> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        fetchCalls.push(input);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            abc123: ["N123AB", "B738", "Boeing", "737-800"]
          })
        } as Response;
      }
    );

    const store = new AircraftIdentityStore(fetchMock as unknown as typeof fetch);
    const tracks = [makeTrack()];

    expect(store.mergeTracks(tracks)).toBe(tracks);
    await expect(store.ensureLoadedForTracks(tracks)).resolves.toBe(true);

    const mergedTracks = store.mergeTracks(tracks);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchCalls[0]).toBe("http://localhost:5173/aircraft-identity/ab.json");
    expect(mergedTracks[0]).toMatchObject({
      registration: "N123AB",
      aircraftTypeCode: "B738",
      renderModelKey: "boeing-737-family"
    });

    await expect(store.ensureLoadedForTracks(tracks)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent loads for the same shard prefix while a fetch is in flight", async () => {
    let resolveResponse!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    );

    const store = new AircraftIdentityStore(fetchMock as unknown as typeof fetch);
    const tracks = [makeTrack()];
    const firstLoad = store.ensureLoadedForTracks(tracks);
    const secondLoad = store.ensureLoadedForTracks(tracks);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse({
      ok: true,
      status: 200,
      json: async () => ({
        abc123: ["N123AB", "B738", "Boeing", "737-800"]
      })
    } as Response);

    await expect(firstLoad).resolves.toBe(true);
    await expect(secondLoad).resolves.toBe(true);
    expect(store.mergeTracks(tracks)[0]).toMatchObject({
      registration: "N123AB",
      aircraftTypeCode: "B738"
    });
  });

  it("treats shard fetch failures as non-blocking and does not retry in the same session", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: false,
          status: 503,
          json: async () => ({})
        }) as Response
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const store = new AircraftIdentityStore(fetchMock as unknown as typeof fetch);
    const tracks = [makeTrack()];

    await expect(store.ensureLoadedForTracks(tracks)).resolves.toBe(false);
    await expect(store.ensureLoadedForTracks(tracks)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.mergeTracks(tracks)).toBe(tracks);

    warnSpy.mockRestore();
  });
});

describe("buildAircraftIdentityShardUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves relative Vite bases against the current page for static sub-path hosting", () => {
    expect(buildAircraftIdentityShardUrlFromBase("ab", "./", "https://0x4d44.github.io/worldviewer/")).toBe(
      "https://0x4d44.github.io/worldviewer/aircraft-identity/ab.json"
    );
  });

  it("keeps the static-host sub-path when the current page URL omits the trailing slash", () => {
    expect(buildAircraftIdentityShardUrlFromBase("ab", "./", "https://0x4d44.github.io/worldviewer")).toBe(
      "https://0x4d44.github.io/worldviewer/aircraft-identity/ab.json"
    );
  });

  it("treats dotted app directory names as directories unless they are html documents", () => {
    expect(buildAircraftIdentityShardUrlFromBase("ab", "./", "https://0x4d44.github.io/worldviewer.v2")).toBe(
      "https://0x4d44.github.io/worldviewer.v2/aircraft-identity/ab.json"
    );
    expect(buildAircraftIdentityShardUrlFromBase("ab", "./", "https://0x4d44.github.io/worldviewer/index.html")).toBe(
      "https://0x4d44.github.io/worldviewer/aircraft-identity/ab.json"
    );
  });

  it("resolves absolute Vite sub-path bases from the site origin", () => {
    expect(buildAircraftIdentityShardUrlFromBase("ab", "/worldviewer/", "https://0x4d44.github.io/worldviewer/")).toBe(
      "https://0x4d44.github.io/worldviewer/aircraft-identity/ab.json"
    );
  });

  it("uses the current Vite base config in the production path builder", () => {
    expect(CURRENT_VITE_BASE_URL).toBe("./");
    vi.stubEnv("BASE_URL", CURRENT_VITE_BASE_URL);
    vi.stubGlobal("document", {
      baseURI: "https://0x4d44.github.io/worldviewer.v2/"
    });
    vi.stubGlobal("location", {
      href: "https://0x4d44.github.io/worldviewer"
    });

    expect(buildAircraftIdentityShardUrl("ab")).toBe(
      "https://0x4d44.github.io/worldviewer.v2/aircraft-identity/ab.json"
    );
  });

  it("falls back to a localhost base outside the browser", () => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("location", undefined);
    expect(buildAircraftIdentityShardUrl("ab")).toBe("http://localhost/aircraft-identity/ab.json");
  });

  it("falls back to location.origin when document.baseURI and location.href are unavailable", () => {
    vi.stubEnv("BASE_URL", "./");
    vi.stubGlobal("document", {});
    vi.stubGlobal("location", { origin: "http://localhost:5173" });
    expect(buildAircraftIdentityShardUrl("ab")).toBe("http://localhost:5173/aircraft-identity/ab.json");
  });
});
