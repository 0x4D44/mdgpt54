# Code Review Plan — Worldviewer

## Scope
Full codebase review of the worldviewer repo: a browser-based Earth viewer with live traffic,
terrain, overlays, and a server-side ship relay.

## Codebase Inventory (52 TypeScript source files, ~9,300 LOC)

### Config / Entry
- package.json, tsconfig.json, vite.config.ts, index.html

### Frontend Core (src/)
- main.ts (~800 lines — the monolith orchestrator)
- style.css
- escapeHtml.ts
- detailProfile.ts / .test.ts
- reliefProfile.ts / .test.ts
- projectionBehavior.ts / .test.ts
- searchRequestController.ts / .test.ts

### Overlays (src/overlays/)
- overlayAnchors.ts / .test.ts
- solarTerminator.ts / .test.ts
- weatherRadar.ts / .test.ts

### Traffic System (src/traffic/)
- trafficTypes.ts (shared contract)
- trafficHelpers.ts / .test.ts
- trafficRuntime.ts / .test.ts
- trafficClient.ts / .test.ts
- trafficLayers.ts / .test.ts
- trafficUI.ts / .test.ts
- openskyDirect.ts / .test.ts
- aircraftIdentity.ts / .test.ts
- aircraftIdentityData.ts / .test.ts
- aircraftIconSizing.ts
- aircraft3d.ts / .test.ts
- aircraft3dLayer.ts / .test.ts

### Server (server/)
- trafficRelay.ts / .test.ts
- trafficRelayCore.ts / .test.ts
- bbox.ts / .test.ts
- providers/aisstream.ts / .test.ts

### Scripts (scripts/)
- generateAircraftIdentity.ts / .test.ts

## Review Dimensions
1. **Correctness & Bugs** — failing tests, logic errors, edge cases
2. **Architecture & Design** — modularity, separation of concerns, dependency flow
3. **Type Safety** — strict mode compliance, type narrowing, any/unknown usage
4. **Error Handling & Resilience** — abort controllers, reconnection, stale guards
5. **Security** — XSS, injection, credential handling
6. **Performance** — rendering path, memory leaks, unnecessary work
7. **Test Quality** — coverage, test isolation, mock fidelity
8. **Code Style & Maintainability** — naming, duplication, dead code
9. **Configuration & Build** — dependency health, build pipeline
10. **Documentation** — README accuracy, inline docs

## Execution Order
1. Run tests and type checks (DONE — 213/214 pass, 1 weatherRadar failure)
2. Review each dimension against the full codebase
3. Write comprehensive report with findings, severity, and recommendations
