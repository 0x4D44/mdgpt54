import { afterEach, describe, expect, it, vi } from "vitest";

import { isAbortError, formatCoordinates, searchPlaces, wireSearch, type SearchDeps } from "./searchUI";

describe("isAbortError", () => {
  it("returns true for a DOMException with name AbortError", () => {
    const error = new DOMException("Aborted", "AbortError");
    expect(isAbortError(error)).toBe(true);
  });

  it("returns false for a generic Error", () => {
    expect(isAbortError(new Error("fail"))).toBe(false);
  });

  it("returns false for a non-Error value", () => {
    expect(isAbortError("abort")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

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

describe("searchPlaces", () => {
  it("returns parsed results from a valid geocoder response", async () => {
    const payload = {
      features: [
        {
          geometry: { coordinates: [-0.1278, 51.5074] },
          bbox: [-0.5, 51.2, 0.3, 51.7],
          properties: { geocoding: { label: "London, England" } }
        },
        {
          geometry: { coordinates: [2.3522, 48.8566] },
          properties: { geocoding: { label: "Paris, France" } }
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(payload)
      })
    );

    const results = await searchPlaces("London");

    expect(results).toEqual([
      { label: "London, England", lng: -0.1278, lat: 51.5074, bbox: [-0.5, 51.2, 0.3, 51.7] },
      { label: "Paris, France", lng: 2.3522, lat: 48.8566, bbox: undefined }
    ]);

    vi.unstubAllGlobals();
  });

  it("returns an empty array when there are no features", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ features: [] })
      })
    );

    const results = await searchPlaces("nonexistent");
    expect(results).toEqual([]);

    vi.unstubAllGlobals();
  });

  it("skips features without coordinates", async () => {
    const payload = {
      features: [
        { geometry: {}, properties: { geocoding: { label: "No coords" } } },
        {
          geometry: { coordinates: [10, 20] },
          properties: { geocoding: { label: "Has coords" } }
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(payload)
      })
    );

    const results = await searchPlaces("test");
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("Has coords");

    vi.unstubAllGlobals();
  });

  it("throws when the geocoder returns a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    await expect(searchPlaces("broken")).rejects.toThrow("Geocoder returned 503.");

    vi.unstubAllGlobals();
  });

  it("passes the abort signal through to fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ features: [] })
    });
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await searchPlaces("test", controller.signal);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org"),
      expect.objectContaining({ signal: controller.signal })
    );

    vi.unstubAllGlobals();
  });

  it("uses Unnamed location as fallback when label is missing", async () => {
    const payload = {
      features: [
        {
          geometry: { coordinates: [1, 2] },
          properties: { geocoding: {} }
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(payload)
      })
    );

    const results = await searchPlaces("nolabel");
    expect(results[0].label).toBe("Unnamed location");

    vi.unstubAllGlobals();
  });
});

function createMockDeps(overrides?: Partial<SearchDeps>): SearchDeps & {
  submitHandlers: Array<(e: { preventDefault: () => void }) => void>;
  clickHandlers: Map<unknown, () => void>;
} {
  const submitHandlers: Array<(e: { preventDefault: () => void }) => void> = [];
  const clickHandlers = new Map<unknown, () => void>();

  return {
    submitHandlers,
    clickHandlers,
    searchForm: {
      addEventListener: vi.fn((_type: string, handler: any) => {
        submitHandlers.push(handler);
      })
    } as any,
    searchInput: { value: "" } as any,
    searchMessage: { textContent: "" } as any,
    searchResults: {
      replaceChildren: vi.fn()
    } as any,
    statusPill: { textContent: "" } as any,
    getMap: () => ({
      fitBounds: vi.fn(),
      flyTo: vi.fn()
    }) as any,
    searchRequests: {
      begin: () => ({
        requestId: 1,
        signal: new AbortController().signal
      }),
      isCurrent: () => true,
      finish: vi.fn()
    } as any,
    ...overrides
  };
}

describe("wireSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a submit handler on the form", () => {
    const deps = createMockDeps();
    wireSearch(deps);
    expect(deps.searchForm.addEventListener).toHaveBeenCalledWith("submit", expect.any(Function));
  });

  it("shows message for short queries", async () => {
    const deps = createMockDeps();
    deps.searchInput.value = "a";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });

    expect(deps.searchMessage.textContent).toBe("Search needs at least two characters.");
  });

  it("searches and renders results for valid queries", async () => {
    const payload = {
      features: [
        {
          geometry: { coordinates: [-0.1278, 51.5074] },
          bbox: [-0.5, 51.2, 0.3, 51.7],
          properties: { geocoding: { label: "London" } }
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => payload
      }))
    );

    const buttons: any[] = [];
    vi.stubGlobal("document", {
      createDocumentFragment: vi.fn(() => ({
        append: vi.fn((...args: any[]) => buttons.push(...args))
      })),
      createElement: vi.fn(() => ({
        type: "",
        className: "",
        innerHTML: "",
        addEventListener: vi.fn()
      }))
    });

    const deps = createMockDeps();
    deps.searchInput.value = "London";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.searchMessage.textContent).toContain("Found 1 result");
  });

  it("shows no-results message when geocoder returns empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ features: [] })
      }))
    );

    const deps = createMockDeps();
    deps.searchInput.value = "nonexistent place xyz";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.searchMessage.textContent).toContain("No matching places");
  });

  it("shows error message on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network error");
      })
    );

    const deps = createMockDeps();
    deps.searchInput.value = "London";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.searchMessage.textContent).toBe("Network error");
  });

  it("shows generic error for non-Error throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "string error";
      })
    );

    const deps = createMockDeps();
    deps.searchInput.value = "London";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.searchMessage.textContent).toBe("Search failed against the public geocoder.");
  });

  it("ignores stale requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          features: [
            {
              geometry: { coordinates: [1, 2] },
              properties: { geocoding: { label: "Place" } }
            }
          ]
        })
      }))
    );

    const deps = createMockDeps({
      searchRequests: {
        begin: () => ({
          requestId: 1,
          signal: new AbortController().signal
        }),
        isCurrent: () => false,
        finish: vi.fn()
      } as any
    });
    deps.searchInput.value = "London";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    // Should not update message since request is stale
    expect(deps.searchMessage.textContent).toBe("Searching open place data...");
  });

  it("renders result with bbox uses fitBounds", async () => {
    const fitBounds = vi.fn();
    const payload = {
      features: [
        {
          geometry: { coordinates: [-0.1278, 51.5074] },
          bbox: [-0.5, 51.2, 0.3, 51.7],
          properties: { geocoding: { label: "London" } }
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => payload
      }))
    );

    let clickHandler: (() => void) | null = null;
    vi.stubGlobal("document", {
      createDocumentFragment: vi.fn(() => ({
        append: vi.fn()
      })),
      createElement: vi.fn(() => ({
        type: "",
        className: "",
        innerHTML: "",
        addEventListener: vi.fn((_type: string, handler: () => void) => {
          clickHandler = handler;
        })
      }))
    });

    const deps = createMockDeps({
      getMap: () =>
        ({
          fitBounds,
          flyTo: vi.fn()
        }) as any
    });
    deps.searchInput.value = "London";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    // Click the result
    (clickHandler as (() => void) | null)?.();
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("renders result without bbox uses flyTo", async () => {
    const flyTo = vi.fn();
    const payload = {
      features: [
        {
          geometry: { coordinates: [2.3522, 48.8566] },
          properties: { geocoding: { label: "Paris" } }
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => payload
      }))
    );

    let clickHandler: (() => void) | null = null;
    vi.stubGlobal("document", {
      createDocumentFragment: vi.fn(() => ({
        append: vi.fn()
      })),
      createElement: vi.fn(() => ({
        type: "",
        className: "",
        innerHTML: "",
        addEventListener: vi.fn((_type: string, handler: () => void) => {
          clickHandler = handler;
        })
      }))
    });

    const deps = createMockDeps({
      getMap: () =>
        ({
          fitBounds: vi.fn(),
          flyTo
        }) as any
    });
    deps.searchInput.value = "Paris";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    (clickHandler as (() => void) | null)?.();
    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it("does nothing when map is null during render", async () => {
    const payload = {
      features: [
        {
          geometry: { coordinates: [1, 2] },
          properties: { geocoding: { label: "Place" } }
        }
      ]
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => payload
      }))
    );

    const deps = createMockDeps({ getMap: () => null });
    deps.searchInput.value = "London";
    wireSearch(deps);

    await deps.submitHandlers[0]({ preventDefault: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.searchMessage.textContent).toContain("Found");
    expect(deps.searchResults.replaceChildren).toHaveBeenCalledTimes(1);
  });
});
