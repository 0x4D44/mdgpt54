import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

test.describe("URL Hash State", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("hash initializes map at specified coordinates", async ({ page }) => {
    await page.goto("/#lat=51.75&lng=-1.26&z=15&p=72&b=30");
    await waitForMap(page);

    // Metric elements should show computed values, not the initial "--" placeholder
    await expect(page.locator("#metric-zoom")).not.toHaveText("--");
    await expect(page.locator("#metric-altitude")).not.toHaveText("--");
    await expect(page.locator("#metric-pitch")).not.toHaveText("--");
  });

  test("toggle state encoded in hash: terrain=0 disables terrain", async ({ page }) => {
    await page.goto("/#terrain=0");
    await waitForMap(page);

    const terrainChip = page.locator('[data-toggle="terrain"]');
    await expect(terrainChip).not.toHaveClass(/is-active/);
    await expect(terrainChip).toHaveAttribute("aria-pressed", "false");
  });

  test("toggle state encoded in hash: weather=1 enables weather", async ({ page }) => {
    await page.goto("/#weather=1");
    await waitForMap(page);

    const weatherChip = page.locator('[data-toggle="weather"]');
    await expect(weatherChip).toHaveClass(/is-active/);
    await expect(weatherChip).toHaveAttribute("aria-pressed", "true");
  });

  test("multiple toggle overrides in hash", async ({ page }) => {
    await page.goto("/#terrain=0&buildings=0&spin=0&night=0");
    await waitForMap(page);

    for (const name of ["terrain", "buildings", "spin", "night"]) {
      const chip = page.locator(`[data-toggle="${name}"]`);
      await expect(chip).not.toHaveClass(/is-active/);
      await expect(chip).toHaveAttribute("aria-pressed", "false");
    }
  });

  test("camera movement updates the URL hash", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);

    // Drag the map canvas to trigger a moveend → updateHash cycle
    const mapBox = await page.locator("#map").boundingBox();
    if (!mapBox) throw new Error("Map element not found");

    const cx = mapBox.x + mapBox.width / 2;
    const cy = mapBox.y + mapBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 100, { steps: 5 });
    await page.mouse.up();

    // Wait for the debounced hash update (HASH_DEBOUNCE_MS = 400)
    await page.waitForFunction(() => location.hash.includes("lat="), {
      timeout: 5_000,
    });

    const hash = await page.evaluate(() => location.hash);
    expect(hash).toContain("lat=");
    expect(hash).toContain("lng=");
    expect(hash).toContain("z=");
  });

  test("hash with all defaults produces clean URL (no hash fragment)", async ({ page }) => {
    // Navigate with explicit defaults: lat=21, lng=12, z=1.2, p=0, b=-10, all toggles default
    await page.goto("/#lat=21&lng=12&z=1.2&p=0&b=-10&terrain=1&buildings=1&relief=1&night=1&weather=0&spin=1");
    await waitForMap(page);

    // After the debounced hash write, defaults should be omitted → empty hash
    await page.waitForFunction(
      () => location.hash === "" || location.hash === "#",
      { timeout: 5_000 },
    );

    const hash = await page.evaluate(() => location.hash);
    expect(hash === "" || hash === "#").toBe(true);
  });

  test("toggling a chip updates the hash to reflect new state", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);

    // Terrain is ON by default → click to turn OFF → hash should include terrain=0
    const terrainChip = page.locator('[data-toggle="terrain"]');
    await terrainChip.click();

    await page.waitForFunction(() => location.hash.includes("terrain=0"), {
      timeout: 5_000,
    });

    const hash = await page.evaluate(() => location.hash);
    expect(hash).toContain("terrain=0");
  });
});
