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

// OpenSky OAuth2 client-credentials. Anonymous access is per-IP rate-limited
// (~400/day) and Cloudflare's shared egress IPs are permanently over that quota,
// so OpenSky drops the connection (HTTP 522). Authenticated access is tied to the
// account (~4000/day) and is served regardless of the caller IP. Set the worker
// secrets OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET to enable it.
const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// Cached per isolate; refreshed before expiry.
let cachedToken = null; // { value: string, expiresAt: number(ms) }

async function getAccessToken(env) {
  if (!env || !env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) {
    return null; // anonymous fallback
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.value;
  }

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET
    })
  });
  if (!resp.ok) {
    cachedToken = null;
    return null; // fall back to anonymous on auth failure
  }
  const data = await resp.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (typeof data.expires_in === "number" ? data.expires_in * 1000 : 1_800_000)
  };
  return cachedToken.value;
}

export default {
  async fetch(request, env) {
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

    const headers = { Accept: "application/json" };
    try {
      const token = await getAccessToken(env);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // token fetch failed; proceed anonymously
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(UPSTREAM + url.pathname + url.search, { headers });
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
