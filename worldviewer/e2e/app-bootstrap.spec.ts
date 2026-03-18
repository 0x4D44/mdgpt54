import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

test.describe("App Bootstrap", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
  });

  test("app shell renders core elements", async ({ page }) => {
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("#control-dock")).toBeVisible();
    await expect(page.locator("#status-pill")).toBeVisible();
  });

  test("status pill transitions from loading to ready", async ({ page }) => {
    // After waitForMap, the pill should no longer show the loading message.
    // Verify it has *some* text that is not the loading text.
    await expect(page.locator("#status-pill")).not.toHaveText("Loading open Earth layers...");
  });

  test("default toggle states", async ({ page }) => {
    // ON by default: terrain, relief, night, buildings, spin
    for (const name of ["terrain", "relief", "night", "buildings", "spin"]) {
      const toggle = page.locator(`[data-toggle="${name}"]`);
      await expect(toggle).toHaveClass(/is-active/);
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
    }

    // OFF by default: weather, earthquakes, iss, measure
    for (const name of ["weather", "earthquakes", "iss", "measure"]) {
      const toggle = page.locator(`[data-toggle="${name}"]`);
      await expect(toggle).not.toHaveClass(/is-active/);
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
    }
  });

  test("canvas appears inside #map", async ({ page }) => {
    await expect(page.locator("#map canvas")).toBeVisible();
  });

  test("time scrubber is visible when Night defaults to on", async ({ page }) => {
    await expect(page.locator("#time-scrubber")).toBeVisible();
  });
});

test.describe("App Bootstrap — error path", () => {
  test("shows error when style fetch fails", async ({ page }) => {
    // Override just the style endpoint to return 500
    await page.route("**/tiles.openfreemap.org/styles/**", (route) =>
      route.fulfill({ status: 500 }),
    );
    // Still mock tiles to prevent other network errors
    await page.route(/\.(pbf|png|jpg)(\?|$)/, (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
    await page.goto("/");
    await expect(page.locator("#status-pill")).toHaveClass(/is-error/);
  });
});
