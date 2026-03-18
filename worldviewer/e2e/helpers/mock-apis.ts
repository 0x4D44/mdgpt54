import { Page } from "@playwright/test";

// Minimal valid MapLibre style - must have at least one layer (empty layers[] crashes buildMapStyle)
const STUB_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#000" } }],
  glyphs: "https://stub.local/fonts/{fontstack}/{range}.pbf",
};

const STUB_ISS = {
  name: "iss",
  id: 25544,
  latitude: 51.5,
  longitude: -0.1,
  altitude: 408.5,
  velocity: 27600,
  visibility: "daylight",
  timestamp: 1710720000,
};

const STUB_QUAKES = {
  type: "FeatureCollection",
  features: [],
};

export async function mockAllApis(page: Page): Promise<void> {
  // OpenFreeMap style (CRITICAL - without this, buildMapStyle() throws and app crashes)
  await page.route("**/tiles.openfreemap.org/styles/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STUB_STYLE) }),
  );

  // Tile requests: vector tiles, terrain PNGs, satellite JPGs, font glyphs
  await page.route(/\.(pbf|png|jpg)(\?|$)/, (route) =>
    route.fulfill({ status: 200, body: "" }),
  );

  // Nominatim geocoder - default empty results; individual tests override with fixture data
  await page.route("**/nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ type: "FeatureCollection", features: [] }),
    }),
  );

  // OpenSky aircraft states - default empty
  await page.route("**/opensky-network.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ time: 0, states: [] }),
    }),
  );

  // Aircraft identity CSV shards
  await page.route("**/aircraft-identity/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/csv", body: "" }),
  );

  // ISS tracker
  await page.route("**/api.wheretheiss.at/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STUB_ISS),
    }),
  );

  // USGS earthquakes
  await page.route("**/earthquake.usgs.gov/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STUB_QUAKES),
    }),
  );

  // Weather radar (RainViewer)
  await page.route("**/rainviewer**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: "0.7", generated: 0, host: "", radar: { past: [], nowcast: [] } }),
    }),
  );
}
