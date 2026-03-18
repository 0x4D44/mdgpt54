import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { waitForMap } from "./helpers/wait-for-map";

test.describe("Coordinate Readout", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["clipboard-write"]);
    await mockAllApis(page);
    await page.goto("/");
    await waitForMap(page);
  });

  test("readout starts hidden", async ({ page }) => {
    await expect(page.locator("#coord-readout")).toBeHidden();
  });

  test("mouse move over map reveals readout with coordinate text", async ({ page }) => {
    const map = page.locator("#map");
    const box = (await map.boundingBox())!;

    // Move mouse to the centre of the map canvas
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const readout = page.locator("#coord-readout");
    await expect(readout).toBeVisible();
    await expect(readout).not.toHaveText("");
  });

  test("clicking readout shows Copied! in status pill", async ({ page }) => {
    const map = page.locator("#map");
    const box = (await map.boundingBox())!;

    // Reveal the readout first
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("#coord-readout")).toBeVisible();

    await page.locator("#coord-readout").click();

    await expect(page.locator("#status-pill")).toHaveText("Copied!");
  });
});
