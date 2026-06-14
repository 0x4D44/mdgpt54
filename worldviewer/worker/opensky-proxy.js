/**
 * OpenSky CORS proxy — Cloudflare Worker (also adaptable to other serverless runtimes).
 *
 * Why: OpenSky's anonymous API responds with
 *   Access-Control-Allow-Origin: https://opensky-network.org
 * which browsers block for any other page origin. Worldviewer is served from
 * GitHub Pages, so the browser cannot fetch OpenSky directly. This stateless
 * proxy forwards the two read-only OpenSky endpoints the app uses and returns
 * permissive CORS for the allow-listed page origins.
 *
 * Deploy (no build step needed):
 *   - Cloudflare dashboard: Workers & Pages -> Create -> paste this file -> Deploy.
 *     You get a URL like https://worldviewer-opensky.<account>.workers.dev
 *   - Then build the site with VITE_OPENSKY_BASE set to that URL, e.g.
 *       VITE_OPENSKY_BASE=https://worldviewer-opensky.<account>.workers.dev npm run build
 *     and copy dist/* into 0x4d44.github.io/worldviewer/.
 *   - The site CSP already allows https://*.workers.dev; if you use a custom
 *     domain, add it to connect-src in index.html.
 *
 * Scope/abuse: only GET, only the two OpenSky paths, only the allow-listed
 * origins. Origin is spoofable by non-browser clients, so this is a personal-use
 * guard, not strong auth — fine for a demo, watch OpenSky rate limits.
 */

const UPSTREAM = "https://opensky-network.org";
const ALLOWED_PATHS = new Set(["/api/states/all", "/api/routes"]);
const ALLOWED_ORIGINS = new Set([
  "https://0x4d44.github.io",
  "http://localhost:5173",
  "http://localhost:8000",
  "http://127.0.0.1:5173"
]);
const DEFAULT_ORIGIN = "https://0x4d44.github.io";

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.has(url.pathname)) {
      return new Response("Not Found", { status: 404, headers: cors });
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(UPSTREAM + url.pathname + url.search, {
        headers: { Accept: "application/json" }
      });
    } catch {
      return new Response(JSON.stringify({ error: "upstream fetch failed" }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const body = await upstreamResponse.arrayBuffer();
    return new Response(body, {
      status: upstreamResponse.status,
      headers: {
        ...cors,
        "Content-Type": upstreamResponse.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "public, max-age=10"
      }
    });
  }
};
