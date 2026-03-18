import { test, expect } from "@playwright/test";
import { mockAllApis } from "./helpers/mock-apis";
import { mockShipRelay } from "./helpers/mock-ship-relay";
import { waitForMap } from "./helpers/wait-for-map";
import openskyFixture from "./fixtures/opensky-states.json" with { type: "json" };
import shipRelayFixture from "./fixtures/ship-relay-message.json" with { type: "json" };

test.describe("Traffic System", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    // Navigate with zoom >= 5 so traffic activates (MIN_LIVE_TRAFFIC_ZOOM = 5)
    await page.goto("/#z=8&lat=51.5&lng=-0.1");
    await waitForMap(page);
    // Wait for traffic UI to be injected (async after map style loads)
    await page.waitForSelector('[data-traffic-toggle="aircraft"]');
  });

  test("traffic section renders in control dock", async ({ page }) => {
    await expect(page.locator('[data-traffic-toggle="aircraft"]')).toBeVisible();
    await expect(page.locator('[data-traffic-toggle="ships"]')).toBeVisible();
    await expect(page.locator("#traffic-status")).toBeVisible();
  });

  test("aircraft toggle ON then OFF transitions aria-pressed and is-active", async ({ page }) => {
    // Override the default empty OpenSky mock with canned fixture data
    let openskyServed = false;
    await page.route("**/opensky-network.org/**", (route) => {
      openskyServed = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(openskyFixture),
      });
    });

    const toggle = page.locator('[data-traffic-toggle="aircraft"]');

    // Default state: OFF
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).not.toHaveClass(/is-active/);

    // Toggle ON
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveClass(/is-active/);

    // Wait for mock OpenSky data to be served
    await expect(() => expect(openskyServed).toBe(true)).toPass({ timeout: 5_000 });

    // Toggle OFF
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).not.toHaveClass(/is-active/);
  });

  test("ships toggle ON then OFF transitions aria-pressed and is-active", async ({ page }) => {
    // Set up ship relay mock — must be done before the WS connects.
    // Since mockAllApis + goto already happened in beforeEach, we set up
    // a fresh relay route. The relay helper calls page.routeWebSocket which
    // intercepts the next WS connection attempt.
    const relay = await mockShipRelay(page);

    const toggle = page.locator('[data-traffic-toggle="ships"]');

    // Default state: OFF
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).not.toHaveClass(/is-active/);

    // Toggle ON — this triggers the WebSocket connection attempt
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveClass(/is-active/);

    // Push mock ship data through the relay
    relay.sendShipData(shipRelayFixture);

    // Toggle OFF
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).not.toHaveClass(/is-active/);

    relay.close();
  });

  test("connection status updates on ship WebSocket connect/disconnect", async ({ page }) => {
    const relay = await mockShipRelay(page);
    const shipsToggle = page.locator('[data-traffic-toggle="ships"]');
    const status = page.locator("#traffic-status");

    // Start: Off
    await expect(status).toHaveText("Off");

    // Toggle ships ON — status should transition away from "Off"
    await shipsToggle.click();
    await expect(status).not.toHaveText("Off");

    // Close the WebSocket — status should show a non-live state
    relay.close();
    await expect(status).toHaveText(/Reconnecting|Off|Static Only/);
  });

  test("both toggles off shows disconnected/off status", async ({ page }) => {
    const aircraftToggle = page.locator('[data-traffic-toggle="aircraft"]');
    const shipsToggle = page.locator('[data-traffic-toggle="ships"]');
    const status = page.locator("#traffic-status");

    // Both off by default — status should show "Off"
    await expect(status).toHaveText("Off");

    // Turn aircraft ON then OFF
    await aircraftToggle.click();
    await expect(aircraftToggle).toHaveAttribute("aria-pressed", "true");
    await aircraftToggle.click();
    await expect(aircraftToggle).toHaveAttribute("aria-pressed", "false");

    // Turn ships ON then OFF
    const relay = await mockShipRelay(page);
    await shipsToggle.click();
    await expect(shipsToggle).toHaveAttribute("aria-pressed", "true");
    await shipsToggle.click();
    await expect(shipsToggle).toHaveAttribute("aria-pressed", "false");
    relay.close();

    // Both off again — status returns to "Off"
    await expect(status).toHaveText("Off");
  });
});

test.describe("Traffic System — error path", () => {
  test("OpenSky 429 rate limit shows degraded aircraft hint", async ({ page }) => {
    // Mock all APIs first (provides base stubs including a 200 for OpenSky)
    await mockAllApis(page);

    // Override OpenSky with 429 AFTER mockAllApis — last-registered route wins in Playwright
    await page.route("**/opensky-network.org/**", (route) =>
      route.fulfill({ status: 429, contentType: "text/plain", body: "Too Many Requests" }),
    );

    await page.goto("/#z=8&lat=51.5&lng=-0.1");
    await waitForMap(page);
    await page.waitForSelector('[data-traffic-toggle="aircraft"]');

    const toggle = page.locator('[data-traffic-toggle="aircraft"]');
    const hints = page.locator("#traffic-hints");
    const status = page.locator("#traffic-status");

    // Turn aircraft ON — this triggers a fetch to OpenSky which will 429
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Wait for the error to propagate to the UI
    await expect(status).toHaveText("Aircraft feed error", { timeout: 10_000 });

    // Hints should become visible with the error message
    await expect(hints).not.toBeHidden();
    await expect(hints).toHaveText(/Aircraft feed failed/);
  });
});
