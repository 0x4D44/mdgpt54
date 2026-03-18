import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

test.describe("Side Panel & Dock Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
  });

  test("dock toggle starts expanded", async ({ page }) => {
    const toggle = page.locator("#dock-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("<");
    await expect(page.locator("#control-dock")).not.toHaveClass(/is-collapsed/);
  });

  test("clicking toggle collapses the side panel", async ({ page }) => {
    const toggle = page.locator("#dock-toggle");
    const dock = page.locator("#control-dock");

    await toggle.click();

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveText(">");
    await expect(dock).toHaveClass(/is-collapsed/);
  });

  test("clicking toggle again re-expands the side panel", async ({ page }) => {
    const toggle = page.locator("#dock-toggle");
    const dock = page.locator("#control-dock");

    // Collapse
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Re-expand
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("<");
    await expect(dock).not.toHaveClass(/is-collapsed/);
  });
});
