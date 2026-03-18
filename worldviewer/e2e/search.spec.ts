import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";
import nominatimFixture from "./fixtures/nominatim-response.json" with { type: "json" };

test.describe("Search", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
  });

  test("submit search shows results", async ({ page }) => {
    await page.route("**/nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(nominatimFixture),
      }),
    );

    await page.locator("#search-input").fill("Oxford");
    await page.locator("#search-form").evaluate((form) => form.requestSubmit());

    await expect(page.locator(".search-result")).toHaveCount(2);
    await expect(page.locator("#search-message")).toHaveText("Found 2 results.");
  });

  test("click result shows flying status pill", async ({ page }) => {
    await page.route("**/nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(nominatimFixture),
      }),
    );

    await page.locator("#search-input").fill("Oxford");
    await page.locator("#search-form").evaluate((form) => form.requestSubmit());
    await expect(page.locator(".search-result")).toHaveCount(2);

    await page.locator(".search-result").first().click();

    await expect(page.locator("#status-pill")).toHaveText(
      "Flying to Oxford, Oxfordshire, England...",
    );
  });

  test("empty results show no-match message", async ({ page }) => {
    // Default mock from mockAllApis already returns empty features — no override needed
    await page.locator("#search-input").fill("Zyxwvut");
    await page.locator("#search-form").evaluate((form) => form.requestSubmit());

    await expect(page.locator("#search-message")).toHaveText(
      "No matching places came back from the public geocoder.",
    );
    await expect(page.locator(".search-result")).toHaveCount(0);
  });

  test("error path shows error message", async ({ page }) => {
    await page.route("**/nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({ status: 500 }),
    );

    await page.locator("#search-input").fill("Oxford");
    await page.locator("#search-form").evaluate((form) => form.requestSubmit());

    await expect(page.locator("#search-message")).toHaveText("Geocoder returned 500.");
  });

  test("/ keyboard shortcut focuses search input", async ({ page }) => {
    // Ensure input is not already focused
    await page.locator("#map").click();
    await expect(page.locator("#search-input")).not.toBeFocused();

    await page.keyboard.press("/");

    await expect(page.locator("#search-input")).toBeFocused();
  });
});
