import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EARTHQUAKE_API_URL } from "./overlays/earthquakeOverlay";
import { ISS_API_URL } from "./overlays/issTracker";
import { WEATHER_RADAR_METADATA_URL } from "./overlays/weatherRadar";
import { airplanesLiveUrl } from "./traffic/airplanesLive";
import { openSkyUrl } from "./traffic/openskyDirect";

// index.html lives one level above src/. Read the source HTML the Vite build
// copies through verbatim.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function cspContent(): string {
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i
  );
  return match ? match[1] : "";
}

describe("Content-Security-Policy", () => {
  const csp = cspContent();

  it("declares a CSP and a referrer policy", () => {
    expect(csp.length).toBeGreaterThan(0);
    expect(csp).toContain("default-src 'self'");
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="strict-origin-when-cross-origin"/i);
  });

  it("keeps script-src to self (the app is fully self-hosted, no CDN)", () => {
    expect(csp).toContain("script-src 'self'");
  });

  it("allows MapLibre's worker/blob and data URIs (load-bearing)", () => {
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("img-src 'self' data: blob:");
  });

  // Anti-drift: every external endpoint the code actually contacts must be
  // covered by the CSP. Adding a new external origin without updating the CSP
  // fails this test.
  const requiredOrigins = [
    new URL(EARTHQUAKE_API_URL).origin,
    new URL(ISS_API_URL).origin,
    new URL(WEATHER_RADAR_METADATA_URL).origin,
    new URL(openSkyUrl([0, 0, 1, 1])).origin,
    new URL(airplanesLiveUrl([0, 0, 1, 1])).origin,
    // Origins from module-private constants (documented here so drift is caught
    // if the CSP is trimmed): map style, satellite tiles, terrain DEM, geocoder,
    // flight-route API, and the RainViewer tile CDN wildcard.
    "https://tiles.openfreemap.org",
    "https://tiles.maps.eox.at",
    "https://elevation-tiles-prod.s3.amazonaws.com",
    "https://nominatim.openstreetmap.org",
    "https://opensky-network.org"
  ];

  it.each(requiredOrigins)("allow-lists %s in connect-src or via wildcard", (origin) => {
    const host = new URL(origin).hostname;
    const wildcard = `https://*.${host.split(".").slice(-2).join(".")}`;
    expect(csp.includes(origin) || csp.includes(wildcard)).toBe(true);
  });
});
