import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

test.describe("Telemetry Metrics", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
  });

  test("mode shows zoom-bracket label at default zoom", async ({ page }) => {
    // Default zoom is 1.2 → classifyView returns "Orbit"
    const mode = page.locator("#metric-mode");
    await expect(mode).toHaveText("Orbit");

    // Must NOT show map-projection labels
    await expect(mode).not.toHaveText("Globe");
    await expect(mode).not.toHaveText("Mercator");
  });

  test("zoom, altitude, and pitch show numeric values after map loads", async ({ page }) => {
    const zoom = page.locator("#metric-zoom");
    const altitude = page.locator("#metric-altitude");
    const pitch = page.locator("#metric-pitch");

    // None should be placeholder text
    await expect(zoom).not.toHaveText("--");
    await expect(zoom).not.toHaveText("Loading...");
    await expect(altitude).not.toHaveText("--");
    await expect(altitude).not.toHaveText("Loading...");
    await expect(pitch).not.toHaveText("--");
    await expect(pitch).not.toHaveText("Loading...");

    // Zoom should be a decimal number (e.g. "1.20")
    await expect(zoom).toHaveText(/^\d+\.\d{2}$/);

    // Altitude should end with "km" or "m" (formatDistance output)
    await expect(altitude).toHaveText(/\d+(\.\d+)?\s*(km|m)$/);

    // Pitch should end with ° symbol (e.g. "0°")
    await expect(pitch).toHaveText(/^\d+°$/);
  });

  test("terrain metric shows '--' when terrain is on (no DEM data)", async ({ page }) => {
    // Terrain is enabled by default. Mock tiles provide no elevation data,
    // so queryTerrainElevation returns null → formatElevation returns "--".
    const terrain = page.locator("#metric-terrain");
    await expect(terrain).toHaveText("--");
  });

  test("terrain metric shows 'Off' after toggling terrain off", async ({ page }) => {
    const terrain = page.locator("#metric-terrain");
    const terrainChip = page.locator('[data-toggle="terrain"]');

    // Terrain is ON by default → turn it OFF
    await terrainChip.click();
    await expect(terrain).toHaveText("Off");

    // Turn it back ON → should no longer say "Off"
    await terrainChip.click();
    await expect(terrain).not.toHaveText("Off");
  });
});
