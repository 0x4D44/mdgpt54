import { afterEach, describe, expect, it, vi } from "vitest";

import { formatCoordinates, isAbortError, searchPlaces, wireSearch } from "./searchUI";
import type { SearchDeps } from "./searchUI";

// ---------------------------------------------------------------------------
// Helpers -- minimal DOM stubs following the trafficUI.test.ts pattern
// ---------------------------------------------------------------------------

function makeForm() {
  const listeners: Record<string, Function> = {};
  return {
    addEventListener: (event: string, handler: Function) => {
      listeners[event] = handler;
    },
    _fire: (event: string, ...args: unknown[]) => listeners[event]?.(...args),
    _listeners: listeners
  } as unknown as HTMLFormElement & { _fire: (e: string, ...a: unknown[]) => void };
}

function makeInput(value = ""): HTMLInputElement {
  return { value } as HTMLInputElement;
}

function makeParagraph(): HTMLParagraphElement & { textContent: string } {
  return { textContent: "" } as HTMLParagraphElement & { textContent: string };
}

function makeDiv(): HTMLDivElement & {
  replaceChildren: ReturnType<typeof vi.fn>;
  children: unknown[];
} {
  const children: unknown[] = [];
  return {
    children,
    replaceChildren: vi.fn((...args: unknown[]) => {
      children.length = 0;
      children.push(...args);
    })
  } as unknown as HTMLDivElement & {
    replaceChildren: ReturnType<typeof vi.fn>;
    children: unknown[];
  };
}

function makeStatusPill(): HTMLElement & { textContent: string } {
  return { textContent: "" } as HTMLElement & { textContent: string };
}

function makeSearchRequests() {
  let reqId = 0;
  let current = 0;
  return {
    begin: vi.fn(() => {
      reqId += 1;
      current = reqId;
      return { requestId: reqId, signal: new AbortController().signal };
    }),
    isCurrent: vi.fn((id: number) => id === current),
    finish: vi.fn((id: number) => {
      if (id === current) current = 0;
    })
  };
}

function makeDeps(
  overrides: Partial<SearchDeps> = {}
): SearchDeps & {
  searchForm: ReturnType<typeof makeForm>;
  searchRequests: ReturnType<typeof makeSearchRequests>;
} {
  const defaults = {
    searchForm: makeForm(),
    searchInput: makeInput(),
    searchMessage: makeParagraph(),
    searchResults: makeDiv(),
    statusPill: makeStatusPill(),
    getMap: () => null,
    searchRequests: makeSearchRequests()
  };
  return { ...defaults, ...overrides } as ReturnType<typeof makeDeps>;
}

function stubDocument() {
  const clickHandlers: Function[] = [];
  const createdButtons: Array<{
    type: string;
    className: string;
    innerHTML: string;
    addEventListener: ReturnType<typeof vi.fn>;
  }> = [];
  const fragment = { append: vi.fn() };

  vi.stubGlobal("document", {
    createDocumentFragment: () => fragment,
    createElement: () => {
      const btn = {
        type: "",
        className: "",
        innerHTML: "",
        addEventListener: vi.fn((_event: string, handler: Function) => {
          clickHandlers.push(handler);
        })
      };
      createdButtons.push(btn);
      return btn;
    }
  });

  return { clickHandlers, createdButtons, fragment };
}

function makeMap() {
  return { fitBounds: vi.fn(), flyTo: vi.fn() };
}

function stubFetchWith(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload)
    })
  );
}

function nominatimFeature(
  lng: number,
  lat: number,
  label: string,
  bbox?: [number, number, number, number]
) {
  return {
    geometry: { coordinates: [lng, lat] },
    ...(bbox ? { bbox } : {}),
    properties: { geocoding: { label } }
  };
}

// ---------------------------------------------------------------------------
// Pure utility tests
// ---------------------------------------------------------------------------

describe("formatCoordinates", () => {
  it("formats lat/lng to four decimal places", () => {
    expect(formatCoordinates(51.5074, -0.1278)).toBe("51.5074, -0.1278");
  });

  it("pads short decimals with trailing zeros", () => {
    expect(formatCoordinates(0, 0)).toBe("0.0000, 0.0000");
  });

  it("truncates long decimals to four places", () => {
    expect(formatCoordinates(51.50741234, -0.12789999)).toBe("51.5074, -0.1279");
  });
});

describe("isAbortError", () => {
  it("returns true for a DOMException with name AbortError", () => {
    const error = new DOMException("Aborted", "AbortError");
    expect(isAbortError(error)).toBe(true);
  });

  it("returns false for a generic Error", () => {
    expect(isAbortError(new Error("fail"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchPlaces (network layer)
// ---------------------------------------------------------------------------

describe("searchPlaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns parsed results from a valid geocoder response", async () => {
    const payload = {
      features: [
        nominatimFeature(-0.1278, 51.5074, "London, England", [-0.5, 51.2, 0.3, 51.7]),
        nominatimFeature(2.3522, 48.8566, "Paris, France")
      ]
    };
    stubFetchWith(payload);

    const results = await searchPlaces("London");

    expect(results).toEqual([
      {
        label: "London, England",
        lng: -0.1278,
        lat: 51.5074,
        bbox: [-0.5, 51.2, 0.3, 51.7]
      },
      { label: "Paris, France", lng: 2.3522, lat: 48.8566, bbox: undefined }
    ]);

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = new URL(fetchCall[0]);
    expect(url.searchParams.get("q")).toBe("London");
    expect(url.searchParams.get("format")).toBe("geocodejson");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("returns an empty array when there are no features", async () => {
    stubFetchWith({ features: [] });
    expect(await searchPlaces("nonexistent")).toEqual([]);
  });

  it("returns an empty array when features key is missing", async () => {
    stubFetchWith({});
    expect(await searchPlaces("empty")).toEqual([]);
  });

  it("skips features without coordinates", async () => {
    stubFetchWith({
      features: [
        { geometry: {}, properties: { geocoding: { label: "No coords" } } },
        nominatimFeature(10, 20, "Has coords")
      ]
    });

    const results = await searchPlaces("test");
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("Has coords");
  });

  it("uses Unnamed location when label is missing", async () => {
    stubFetchWith({
      features: [{ geometry: { coordinates: [1, 2] }, properties: { geocoding: {} } }]
    });
    const results = await searchPlaces("nolabel");
    expect(results[0].label).toBe("Unnamed location");
  });

  it("uses Unnamed location when properties is missing", async () => {
    stubFetchWith({
      features: [{ geometry: { coordinates: [1, 2] } }]
    });
    const results = await searchPlaces("noprops");
    expect(results[0].label).toBe("Unnamed location");
  });

  it("throws when the geocoder returns a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 })
    );
    await expect(searchPlaces("broken")).rejects.toThrow("Geocoder returned 503.");
  });

  it("passes the abort signal through to fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [] })
    });
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await searchPlaces("test", controller.signal);

    expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// wireSearch (DOM wiring & submit handler)
// ---------------------------------------------------------------------------

describe("wireSearch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("registers a submit listener on the search form", () => {
    const deps = makeDeps();
    wireSearch(deps);
    expect(deps.searchForm._listeners["submit"]).toBeDefined();
  });

  it("calls preventDefault on the submit event", async () => {
    const deps = makeDeps({ searchInput: makeInput("") });
    wireSearch(deps);

    const preventDefault = vi.fn();
    await deps.searchForm._fire("submit", { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("rejects queries shorter than 2 characters", async () => {
    const deps = makeDeps({ searchInput: makeInput("a") });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    expect(deps.searchMessage.textContent).toBe(
      "Search needs at least two characters."
    );
    expect(deps.searchResults.replaceChildren).toHaveBeenCalled();
    expect(deps.searchRequests.finish).toHaveBeenCalled();
  });

  it("trims whitespace before checking query length", async () => {
    const deps = makeDeps({ searchInput: makeInput("  x  ") });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });
    expect(deps.searchMessage.textContent).toBe(
      "Search needs at least two characters."
    );
  });

  it("shows no-results message when geocoder returns empty", async () => {
    stubFetchWith({ features: [] });

    const deps = makeDeps({ searchInput: makeInput("xyznoplace") });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchMessage.textContent).toBe(
        "No matching places came back from the public geocoder."
      );
    });
  });

  it("shows singular result for exactly one match", async () => {
    stubFetchWith({ features: [nominatimFeature(0, 0, "A")] });
    stubDocument();

    const deps = makeDeps({
      searchInput: makeInput("test"),
      getMap: () => makeMap() as any
    });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchMessage.textContent).toBe("Found 1 result.");
    });
  });

  it("shows plural results for multiple matches", async () => {
    stubFetchWith({
      features: [nominatimFeature(0, 0, "A"), nominatimFeature(1, 1, "B")]
    });
    stubDocument();

    const deps = makeDeps({
      searchInput: makeInput("test"),
      getMap: () => makeMap() as any
    });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchMessage.textContent).toBe("Found 2 results.");
    });
  });

  it("displays error message on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const deps = makeDeps({ searchInput: makeInput("London") });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchMessage.textContent).toBe("Network error");
    });
  });

  it("shows generic error for non-Error throw values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("string error"));

    const deps = makeDeps({ searchInput: makeInput("London") });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchMessage.textContent).toBe(
        "Search failed against the public geocoder."
      );
    });
  });

  it("silently ignores abort errors", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const deps = makeDeps({ searchInput: makeInput("London") });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchRequests.finish).toHaveBeenCalled();
    });
    expect(deps.searchMessage.textContent).toBe("Searching open place data...");
  });

  it("drops results when request is superseded (success path)", async () => {
    stubFetchWith({ features: [nominatimFeature(0, 0, "Old")] });

    const deps = makeDeps({ searchInput: makeInput("London") });
    deps.searchRequests.isCurrent.mockReturnValue(false);
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchRequests.finish).toHaveBeenCalled();
    });
    expect(deps.searchMessage.textContent).toBe("Searching open place data...");
  });

  it("drops errors when request is superseded (error path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Late failure"))
    );

    const deps = makeDeps({ searchInput: makeInput("London") });
    deps.searchRequests.isCurrent.mockReturnValue(false);
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchRequests.finish).toHaveBeenCalled();
    });
    expect(deps.searchMessage.textContent).toBe("Searching open place data...");
  });

  it("does not render results when getMap returns null", async () => {
    stubFetchWith({ features: [nominatimFeature(0, 0, "Place")] });

    const deps = makeDeps({
      searchInput: makeInput("London"),
      getMap: () => null
    });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchMessage.textContent).toBe("Found 1 result.");
    });
    expect(deps.searchResults.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// renderSearchResults (tested indirectly through wireSearch + button clicks)
// ---------------------------------------------------------------------------

describe("renderSearchResults via button clicks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls flyTo when a result without bbox is clicked", async () => {
    stubFetchWith({
      features: [nominatimFeature(-0.1278, 51.5074, "London")]
    });
    const { clickHandlers } = stubDocument();

    const mapInstance = makeMap();
    const deps = makeDeps({
      searchInput: makeInput("London"),
      getMap: () => mapInstance as any
    });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(clickHandlers.length).toBeGreaterThan(0);
    });

    clickHandlers[0]();

    expect(mapInstance.flyTo).toHaveBeenCalledWith({
      center: [-0.1278, 51.5074],
      zoom: 15.2,
      pitch: 68,
      bearing: 24,
      speed: 0.9,
      curve: 1.28,
      essential: true
    });
    expect(mapInstance.fitBounds).not.toHaveBeenCalled();
    expect(deps.statusPill.textContent).toBe("Flying to London...");
    expect(deps.searchResults.replaceChildren).toHaveBeenCalled();
  });

  it("calls fitBounds when a result with bbox is clicked", async () => {
    stubFetchWith({
      features: [
        nominatimFeature(2.3522, 48.8566, "Paris", [-0.13, 51.5, -0.12, 51.52])
      ]
    });
    const { clickHandlers } = stubDocument();

    const mapInstance = makeMap();
    const deps = makeDeps({
      searchInput: makeInput("Paris"),
      getMap: () => mapInstance as any
    });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(clickHandlers.length).toBeGreaterThan(0);
    });

    clickHandlers[0]();

    expect(mapInstance.fitBounds).toHaveBeenCalledWith(
      [
        [-0.13, 51.5],
        [-0.12, 51.52]
      ],
      { padding: 84, maxZoom: 16, duration: 1800 }
    );
    expect(mapInstance.flyTo).not.toHaveBeenCalled();
    expect(deps.statusPill.textContent).toBe("Flying to Paris...");
  });

  it("sets correct button attributes on rendered results", async () => {
    stubFetchWith({ features: [nominatimFeature(10, 20, "Place")] });
    const { createdButtons } = stubDocument();

    const deps = makeDeps({
      searchInput: makeInput("Place"),
      getMap: () => makeMap() as any
    });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(createdButtons.length).toBeGreaterThan(0);
    });

    const btn = createdButtons[0];
    expect(btn.type).toBe("button");
    expect(btn.className).toBe("search-result");
    expect(btn.innerHTML).toContain("Place");
    expect(btn.innerHTML).toContain("20.0000, 10.0000");
  });

  it("appends the fragment to searchResults", async () => {
    stubFetchWith({ features: [nominatimFeature(0, 0, "A")] });
    const { fragment } = stubDocument();

    const deps = makeDeps({
      searchInput: makeInput("test"),
      getMap: () => makeMap() as any
    });
    wireSearch(deps);

    await deps.searchForm._fire("submit", { preventDefault: vi.fn() });

    await vi.waitFor(() => {
      expect(deps.searchResults.replaceChildren).toHaveBeenCalledWith(fragment);
    });
  });
});
