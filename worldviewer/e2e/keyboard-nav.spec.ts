import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

const PRESETS = [
  { key: "1", label: "Earthrise" },
  { key: "2", label: "Edinburgh" },
  { key: "3", label: "Oxford" },
  { key: "4", label: "Enfield" },
  { key: "5", label: "Seattle" },
  { key: "6", label: "Tokyo" },
] as const;

test.describe("Keyboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
    // Ensure nothing is focused
    await page.locator("body").click();
  });

  // --- / focuses search input ---

  test("/ focuses #search-input", async ({ page }) => {
    await expect(page.locator("#search-input")).not.toBeFocused();

    await page.keyboard.press("/");

    await expect(page.locator("#search-input")).toBeFocused();
  });

  // --- Escape blurs search input ---

  test("Escape blurs search input", async ({ page }) => {
    await page.keyboard.press("/");
    await expect(page.locator("#search-input")).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(page.locator("#search-input")).not.toBeFocused();
  });

  // --- Number keys 1-6 trigger presets ---

  for (const preset of PRESETS) {
    test(`key "${preset.key}" shows "Flying to ${preset.label}..."`, async ({ page }) => {
      await page.keyboard.press(preset.key);

      await expect(page.locator("#status-pill")).toHaveText(`Flying to ${preset.label}...`);
    });
  }

  // --- Letter shortcuts toggle overlays ---

  test("T toggles terrain (aria-pressed flips)", async ({ page }) => {
    const chip = page.locator('[data-toggle="terrain"]');

    // Terrain defaults ON
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("t");
    await expect(chip).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("t");
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  test("N toggles night (aria-pressed flips)", async ({ page }) => {
    const chip = page.locator('[data-toggle="night"]');

    // Night defaults ON
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("n");
    await expect(chip).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("n");
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  test("W toggles weather (aria-pressed flips)", async ({ page }) => {
    const chip = page.locator('[data-toggle="weather"]');

    // Weather defaults OFF
    await expect(chip).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("w");
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("w");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  // --- Traffic toggle shortcuts (async-injected UI) ---

  test("A toggles aircraft via keyboard", async ({ page }) => {
    await page.waitForSelector('[data-traffic-toggle="aircraft"]');
    const toggle = page.locator('[data-traffic-toggle="aircraft"]');

    // Aircraft defaults OFF
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("a");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("a");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("S toggles ships via keyboard", async ({ page }) => {
    await page.waitForSelector('[data-traffic-toggle="ships"]');
    const toggle = page.locator('[data-traffic-toggle="ships"]');

    // Ships defaults OFF
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("s");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("s");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  // --- Shortcuts suppressed when input is focused ---

  test("shortcuts are suppressed when search input is focused", async ({ page }) => {
    const chip = page.locator('[data-toggle="terrain"]');

    // Terrain defaults ON
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    // Focus the search input
    await page.keyboard.press("/");
    await expect(page.locator("#search-input")).toBeFocused();

    // Press T while focused — terrain should NOT toggle
    await page.keyboard.press("t");
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    // Escape still works while focused — blurs the input
    await page.keyboard.press("Escape");
    await expect(page.locator("#search-input")).not.toBeFocused();
  });
});
