import type { Map } from "maplibre-gl";
import { escapeHtml } from "./escapeHtml";
import type { SearchRequestController } from "./searchRequestController";

export type SearchResult = {
  label: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
};

export type SearchDeps = {
  searchForm: HTMLFormElement;
  searchInput: HTMLInputElement;
  searchMessage: HTMLParagraphElement;
  searchResults: HTMLDivElement;
  statusPill: HTMLElement;
  getMap: () => Map | null;
  searchRequests: SearchRequestController;
};

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

export function wireSearch(deps: SearchDeps): void {
  const { searchForm, searchInput, searchMessage, searchResults, searchRequests } = deps;

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const request = searchRequests.begin();
    const query = searchInput.value.trim();
    if (query.length < 2) {
      searchMessage.textContent = "Search needs at least two characters.";
      searchResults.replaceChildren();
      searchRequests.finish(request.requestId);
      return;
    }

    searchMessage.textContent = "Searching open place data...";
    searchResults.replaceChildren();

    try {
      const results = await searchPlaces(query, request.signal);
      if (!searchRequests.isCurrent(request.requestId)) {
        return;
      }

      if (results.length === 0) {
        searchMessage.textContent = "No matching places came back from the public geocoder.";
        return;
      }

      searchMessage.textContent = `Found ${results.length} result${results.length === 1 ? "" : "s"}.`;
      renderSearchResults(deps, results);
    } catch (error) {
      if (!searchRequests.isCurrent(request.requestId) || isAbortError(error)) {
        return;
      }

      searchMessage.textContent =
        error instanceof Error ? error.message : "Search failed against the public geocoder.";
    } finally {
      searchRequests.finish(request.requestId);
    }
  });
}

function renderSearchResults(deps: SearchDeps, results: SearchResult[]): void {
  const { searchResults, statusPill, getMap } = deps;
  const mapInstance = getMap();
  if (!mapInstance) {
    return;
  }

  const fragment = document.createDocumentFragment();
  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.innerHTML = `
      <strong>${escapeHtml(result.label)}</strong>
      <span>${formatCoordinates(result.lat, result.lng)}</span>
    `;
    button.addEventListener("click", () => {
      searchResults.replaceChildren();
      statusPill.textContent = `Flying to ${result.label}...`;

      if (result.bbox) {
        mapInstance.fitBounds(
          [
            [result.bbox[0], result.bbox[1]],
            [result.bbox[2], result.bbox[3]]
          ],
          {
            padding: 84,
            maxZoom: 16,
            duration: 1800
          }
        );
      } else {
        mapInstance.flyTo({
          center: [result.lng, result.lat],
          zoom: 15.2,
          pitch: 68,
          bearing: 24,
          speed: 0.9,
          curve: 1.28,
          essential: true
        });
      }
    });
    fragment.append(button);
  });

  searchResults.replaceChildren(fragment);
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "geocodejson");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    },
    signal
  });

  if (!response.ok) {
    throw new Error(`Geocoder returned ${response.status}.`);
  }

  const payload = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      bbox?: [number, number, number, number];
      properties?: { geocoding?: { label?: string } };
    }>;
  };

  return (payload.features ?? []).reduce<SearchResult[]>((results, feature) => {
    const coordinates = feature.geometry?.coordinates;
    const lng = coordinates?.[0];
    const lat = coordinates?.[1];
    // Untrusted geocoder JSON: skip features without finite coordinates so a
    // bad row can't make formatCoordinates/.toFixed throw and kill the list.
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return results;
    }

    results.push({
      label: feature.properties?.geocoding?.label ?? "Unnamed location",
      lng: lng as number,
      lat: lat as number,
      // Only attach a well-formed bbox; otherwise degrade to flyTo (don't drop
      // an otherwise-valid result).
      bbox: isFiniteBBox(feature.bbox) ? feature.bbox : undefined
    });
    return results;
  }, []);
}

/** True when value is a [minLng, minLat, maxLng, maxLat] tuple of finite numbers. */
export function isFiniteBBox(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
