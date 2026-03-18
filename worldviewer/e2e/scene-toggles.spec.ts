import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

/* ------------------------------------------------------------------ *
 * Toggle configuration table                                         *
 *                                                                    *
 * defaultOn  = true  → first click turns it OFF  → shows offMessage  *
 * defaultOn  = false → first click turns it ON   → shows onMessage   *
 * ------------------------------------------------------------------ */
const toggles = [
  { name: "terrain",     defaultOn: true,  onMsg: "Terrain enabled.",            offMsg: "Terrain flattened." },
  { name: "relief",      defaultOn: true,  onMsg: "Relief overlay enabled.",     offMsg: "Relief overlay hidden." },
  { name: "night",       defaultOn: true,  onMsg: "Night overlay enabled.",      offMsg: "Night overlay hidden." },
  { name: "weather",     defaultOn: false, onMsg: "Weather radar enabled.",      offMsg: "Weather radar hidden." },
  { name: "earthquakes", defaultOn: false, onMsg: "Earthquake layer enabled.",   offMsg: "Earthquake layer hidden." },
  { name: "iss",         defaultOn: false, onMsg: "ISS tracker enabled.",        offMsg: "ISS tracker hidden." },
  { name: "buildings",   defaultOn: true,  onMsg: "3D buildings enabled.",       offMsg: "Buildings hidden." },
  { name: "spin",        defaultOn: true,  onMsg: "Orbital spin enabled.",       offMsg: "Orbital spin paused." },
  { name: "measure",     defaultOn: false, onMsg: "Measure mode: click two points to measure distance.", offMsg: "Measure mode off." },
] as const;

test.describe("Scene Toggle Chips", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
  });

  for (const toggle of toggles) {
    test(`"${toggle.name}" toggle — first click flips state and shows correct status message`, async ({ page }) => {
      const chip = page.locator(`[data-toggle="${toggle.name}"]`);
      const pill = page.locator("#status-pill");

      // --- First click: flip from default state ---
      await chip.click();

      if (toggle.defaultOn) {
        // Was ON → now OFF
        await expect(chip).not.toHaveClass(/is-active/);
        await expect(chip).toHaveAttribute("aria-pressed", "false");
        await expect(pill).toHaveText(toggle.offMsg);
      } else {
        // Was OFF → now ON
        await expect(chip).toHaveClass(/is-active/);
        await expect(chip).toHaveAttribute("aria-pressed", "true");
        await expect(pill).toHaveText(toggle.onMsg);
      }
    });

    test(`"${toggle.name}" toggle — second click restores original state`, async ({ page }) => {
      const chip = page.locator(`[data-toggle="${toggle.name}"]`);
      const pill = page.locator("#status-pill");

      // Click twice to round-trip
      await chip.click();
      await chip.click();

      if (toggle.defaultOn) {
        // Was ON → OFF → back to ON
        await expect(chip).toHaveClass(/is-active/);
        await expect(chip).toHaveAttribute("aria-pressed", "true");
        await expect(pill).toHaveText(toggle.onMsg);
      } else {
        // Was OFF → ON → back to OFF
        await expect(chip).not.toHaveClass(/is-active/);
        await expect(chip).toHaveAttribute("aria-pressed", "false");
        await expect(pill).toHaveText(toggle.offMsg);
      }
    });
  }

  test("night toggle controls time scrubber visibility", async ({ page }) => {
    const nightChip = page.locator('[data-toggle="night"]');
    const scrubber = page.locator("#time-scrubber");

    // Night is ON by default → scrubber should be visible
    await expect(scrubber).toBeVisible();

    // Turn night OFF → scrubber should be hidden
    await nightChip.click();
    await expect(scrubber).toBeHidden();

    // Turn night back ON → scrubber should be visible again
    await nightChip.click();
    await expect(scrubber).toBeVisible();
  });
});
