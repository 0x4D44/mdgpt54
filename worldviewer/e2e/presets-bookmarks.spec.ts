import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

const PRESETS = [
  { id: "earth", label: "Earthrise" },
  { id: "edinburgh", label: "Edinburgh" },
  { id: "oxford", label: "Oxford" },
  { id: "enfield", label: "Enfield" },
  { id: "seattle", label: "Seattle" },
  { id: "tokyo", label: "Tokyo" },
] as const;

const MAX_BOOKMARKS = 24;
const STORAGE_KEY = "worldviewer-bookmarks";

test.describe("Presets & Bookmarks", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
  });

  // --- Preset card clicks ---

  for (const preset of PRESETS) {
    test(`clicking "${preset.id}" preset card shows flying status`, async ({ page }) => {
      await page.locator(`[data-preset="${preset.id}"]`).click();
      await expect(page.locator("#status-pill")).toHaveText(`Flying to ${preset.label}...`);
    });
  }

  // --- Keyboard shortcuts 1-6 ---

  for (let i = 0; i < PRESETS.length; i++) {
    const preset = PRESETS[i];
    test(`keyboard shortcut "${i + 1}" activates "${preset.id}" preset`, async ({ page }) => {
      // Ensure no input is focused so shortcut is not suppressed
      await page.locator("#map").click();

      await page.keyboard.press(`${i + 1}`);
      await expect(page.locator("#status-pill")).toHaveText(`Flying to ${preset.label}...`);
    });
  }

  // --- Save View (bookmark creation) ---

  test("Save View creates a bookmark card", async ({ page }) => {
    // Register dialog handler BEFORE clicking save
    page.on("dialog", (d) => d.accept("My Place"));

    await page.locator("#save-view-btn").click();

    // A bookmark card should appear in the preset grid
    const card = page.locator(".preset-grid [data-bookmark-id]");
    await expect(card).toHaveCount(1);
    await expect(card.locator("strong")).toHaveText("My Place");
  });

  // --- Bookmark card click → fly ---

  test("clicking a bookmark card shows flying status", async ({ page }) => {
    page.on("dialog", (d) => d.accept("My Place"));
    await page.locator("#save-view-btn").click();

    const card = page.locator(".preset-grid [data-bookmark-id]");
    await expect(card).toHaveCount(1);

    await card.click();
    await expect(page.locator("#status-pill")).toHaveText("Flying to My Place...");
  });

  // --- Bookmark delete ---

  test("bookmark delete button removes the card", async ({ page }) => {
    page.on("dialog", (d) => d.accept("Temp Bookmark"));
    await page.locator("#save-view-btn").click();

    const card = page.locator(".preset-grid [data-bookmark-id]");
    await expect(card).toHaveCount(1);

    await card.locator(".bookmark-delete").click();
    await expect(card).toHaveCount(0);
  });

  // --- Bookmark persistence across reload ---

  test("bookmarks persist after page reload", async ({ page }) => {
    page.on("dialog", (d) => d.accept("Persistent Place"));
    await page.locator("#save-view-btn").click();

    const card = page.locator(".preset-grid [data-bookmark-id]");
    await expect(card).toHaveCount(1);

    // Reload within same test (same BrowserContext = same localStorage)
    await page.goto("/");
    await waitForMap(page);

    await expect(page.locator(".preset-grid [data-bookmark-id]")).toHaveCount(1);
    await expect(page.locator(".preset-grid [data-bookmark-id] strong")).toHaveText(
      "Persistent Place",
    );
  });

  // --- Bookmark limit ---

  test(`saving more than ${MAX_BOOKMARKS} bookmarks shows limit message`, async ({ page }) => {
    // Seed localStorage with MAX_BOOKMARKS fake bookmarks
    await page.evaluate(
      ({ key, max }) => {
        const bookmarks = Array.from({ length: max }, (_, i) => ({
          id: `fake-${i}`,
          label: `Bookmark ${i}`,
          caption: `0.00, 0.00`,
          lng: 0,
          lat: 0,
          zoom: 2,
          pitch: 0,
          bearing: 0,
        }));
        localStorage.setItem(key, JSON.stringify(bookmarks));
      },
      { key: STORAGE_KEY, max: MAX_BOOKMARKS },
    );

    // Reload so the app picks up the seeded bookmarks
    await page.goto("/");
    await waitForMap(page);

    // Verify all 24 bookmark cards rendered
    await expect(page.locator(".preset-grid [data-bookmark-id]")).toHaveCount(MAX_BOOKMARKS);

    // Attempt to save one more
    page.on("dialog", (d) => d.accept("One Too Many"));
    await page.locator("#save-view-btn").click();

    await expect(page.locator("#status-pill")).toHaveText(
      `Bookmark limit (${MAX_BOOKMARKS}) reached.`,
    );

    // Count should still be MAX_BOOKMARKS — no new card added
    await expect(page.locator(".preset-grid [data-bookmark-id]")).toHaveCount(MAX_BOOKMARKS);
  });
});
