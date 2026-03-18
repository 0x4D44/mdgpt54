import { Page } from "@playwright/test";

/**
 * Wait for MapLibre to initialize:
 * 1. Canvas appears inside #map
 * 2. Status pill no longer shows "Loading open Earth layers..."
 *
 * Uses `load` event semantics, NOT `idle` — terrain/contour tiles use
 * a custom DEM protocol that page.route() cannot intercept, so tiles
 * may fail to load and `idle` may never fire.
 */
export async function waitForMap(page: Page): Promise<void> {
  // Wait for canvas to appear (MapLibre creates it on init)
  await page.waitForSelector("#map canvas", { timeout: 15_000 });

  // Wait for status pill to transition away from loading text
  await page.waitForFunction(
    () => {
      const pill = document.querySelector("#status-pill");
      return pill && !pill.textContent?.includes("Loading open Earth layers...");
    },
    { timeout: 15_000 },
  );
}
