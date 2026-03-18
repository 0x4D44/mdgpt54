# HLD: Type Safety and Error Handling Improvements

**Date:** 2026-03-16
**Status:** Draft
**Scope:** Three targeted fixes from code review -- type narrowing, retry backoff, debug logging.

---

## 1. Replace `any` with `unknown` in aisstream.ts

### Current Behavior

`parsePositionReport` (line 46) and `parseShipStaticData` (line 78) both accept `msg: any`. Each has an `eslint-disable-next-line @typescript-eslint/no-explicit-any` suppression comment above it.

The functions already perform runtime null-checks using optional chaining (`msg?.Message?.PositionReport`, `msg?.MetaData?.MMSI`, etc.), so the actual logic is safe -- but the `any` type lets callers pass anything without the compiler noticing, and it leaks `any` into downstream expressions.

### Proposed Change

Change both signatures from `msg: any` to `msg: unknown`. This requires no logic changes because:

- Optional chaining on `unknown` is a type error in TypeScript. However, the fix is straightforward: cast `msg` to `Record<string, unknown>` at the top of each function (or use a local assertion helper), then continue drilling into the structure with optional chaining.
- An alternative (and arguably cleaner) approach: define an internal `AISStreamMessage` type that models the expected shape loosely (`Record<string, unknown>` with nested records) and use a type guard or inline narrowing at the entry point. The functions already return `null` for any unexpected shape, so the runtime behavior is unchanged.

Preferred approach: add a single local helper at the top of `aisstream.ts`:

```ts
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
```

Each function then does `const root = asRecord(msg); if (!root) return null;` and drills down with `asRecord(root.Message)` etc. This replaces the optional chaining on `any` with explicit narrowing at each level.

Both `eslint-disable-next-line` comments can be removed after the change.

### Risks

- **Low.** The functions are pure data parsers with comprehensive tests (13 test cases in `aisstream.test.ts`). The test inputs are plain objects, which are valid `unknown` values, so no test changes are needed.
- The only callers are `handleShipFeedMessage` in `trafficRelay.ts` (line 99-114) where the input comes from `JSON.parse`, which already returns `unknown` -- so the call sites are already compatible.
- Marginal risk of making the internal narrowing slightly more verbose; mitigated by the `asRecord` helper keeping it concise.

### Test Plan

- Existing tests in `server/providers/aisstream.test.ts` should pass without modification.
- Add one new test per function: pass a non-object primitive (e.g., `42`, `"string"`, `null`) and assert `null` is returned. This validates the new `unknown` entry guard.
- Verify the two `eslint-disable` suppressions are removed and `npm run lint` passes.

---

## 2. Add Retry Backoff to Aircraft Polling

### Current Behavior

When `pollAircraft` (line 169-228 in `trafficClient.ts`) catches a fetch error:

1. It logs `console.warn("[opensky] browser poll error:", error)` (line 217).
2. It clears `latestAircraft` and sets `aircraftRuntime = "error"` (lines 218-219).
3. The `finally` block calls `ensureAircraftPollTimer()` (line 225), which schedules the next poll at the normal `OPENSKY_POLL_MS` (15 seconds) interval.
4. On the next poll, `pollAircraft` is called again at the same cadence.

During an extended OpenSky outage, this generates a continuous stream of `console.warn` messages every 15 seconds indefinitely. There is no backoff, no failure counter, and no circuit breaker.

### Existing Pattern to Reuse

The ship relay WebSocket already implements exponential backoff in `scheduleReconnect` (lines 397-408):

```
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt), RECONNECT_MAX_MS);
this.reconnectAttempt++;
```

The `reconnectAttempt` counter resets to 0 on successful WebSocket open (line 318).

### Proposed Algorithm

Add an `aircraftConsecutiveErrors` counter (starts at 0) alongside the existing `aircraftRuntime` state.

**On successful poll** (line 204, where `aircraftRuntime = "live"` is set):
- Reset `aircraftConsecutiveErrors = 0`.

**On failed poll** (the catch block, line 212):
- Increment `aircraftConsecutiveErrors`.
- Compute backoff delay: `Math.min(OPENSKY_POLL_MS * Math.pow(2, aircraftConsecutiveErrors - 1), RECONNECT_MAX_MS)`.
  - After 1st failure: 15s (normal cadence).
  - After 2nd failure: 30s (capped at max).
  - After 3rd+ failure: 30s (stays at cap).
- Use this delay instead of the normal poll interval when scheduling the next timer.

**Timer scheduling change in `ensureAircraftPollTimer`:**
- Currently hardcodes `OPENSKY_POLL_MS` as the interval. Change to accept an optional override delay, or compute the delay based on `aircraftConsecutiveErrors`.
- Simplest approach: add a `private aircraftPollDelayMs()` method that returns `OPENSKY_POLL_MS` when `aircraftConsecutiveErrors === 0`, otherwise the backoff delay.

**Recovery:**
- When `aircraftConsecutiveErrors` resets to 0 on success, the next poll automatically returns to the 15s cadence.
- When aircraft are disabled or zoom goes below threshold (`stopAircraftPolling`), also reset `aircraftConsecutiveErrors = 0` so a fresh start gets normal cadence.

**Why not a hard stop after N failures?**
- OpenSky outages are transient. The user has explicitly turned on aircraft; silently giving up would be confusing. The backoff caps at 30s which is reasonable -- it halves the error log volume vs. 15s, and the user already sees the error status in the UI via `AIRCRAFT_FEED_ERROR_MESSAGE`.

### State Transitions

```
[off/zoom_blocked] --enable/zoom--> [loading, errors=0]
[loading]          --success----->  [live, errors=0]
[loading]          --failure----->  [error, errors=1, next poll in 15s]
[live]             --success----->  [live, errors=0]
[live]             --failure----->  [error, errors=1, next poll in 15s]
[error]            --failure----->  [error, errors++, next poll in min(15*2^(n-1), 30)s]
[error]            --success----->  [live, errors=0, next poll in 15s]
[any]              --disable-----> [off, errors=0]
```

### Risks

- **Low.** The change is additive (one new counter, one modified delay calculation). The existing poll lifecycle (abort controller, fetch-in-flight guard, disposed check) is unchanged.
- Edge case: if the user disables and re-enables aircraft rapidly during an outage, the counter resets and the first poll fires at normal cadence. This is fine -- it gives a fresh attempt.
- The `RECONNECT_MAX_MS` constant (30s) is already defined and used for ships, so reusing it for aircraft keeps the codebase consistent.

### Test Plan

- **Unit test: backoff delay increases after consecutive failures.**
  Mock `fetch` to reject. Call `setLayers(true, false)`. Use fake timers. Advance by 15s, verify second fetch fires. Make it fail again. Advance by 30s (backoff), verify third fetch fires. Verify it does not fire at 15s.

- **Unit test: backoff resets on success.**
  Mock `fetch` to fail twice, then succeed. Verify the next poll after success fires at the normal 15s interval, not the backoff interval.

- **Unit test: counter resets when aircraft are disabled.**
  Fail a few polls, then call `setLayers(false, false)`. Re-enable. Verify first poll fires at normal cadence (counter was reset).

- **Existing tests pass.** The current test "publishes aircraft-specific failure status when the browser feed request fails" should pass unchanged -- it only checks the status after one failure and does not assert timer behavior.

---

## 3. Add Debug Logging to Silent Catch Blocks

### Current Behavior

Three locations swallow parse errors with empty `catch {}` blocks and a `// ignore malformed messages` comment:

| Location | Context |
|---|---|
| `trafficClient.ts:341` | Browser-side WebSocket `message` handler for ship relay snapshots. `JSON.parse(event.data)` or `parseSnapshot(data)` could throw. |
| `trafficRelay.ts:116` | Server-side `handleShipFeedMessage`. `JSON.parse(String(raw))` for AISStream messages could throw on malformed JSON. |
| `trafficRelay.ts:212-213` | Server-side client `message` handler. `JSON.parse(String(raw))` for browser subscribe messages could throw. |

All three are intentionally silent: malformed messages from external sources (AISStream, browser clients) should not crash the process or flood logs in production. However, during development and debugging, having zero visibility into parse failures makes it hard to diagnose protocol mismatches or data corruption.

### Logging Mechanisms in the Codebase

**Client-side (`trafficClient.ts`):**
- Uses `console.warn` directly (e.g., line 217: `console.warn("[opensky] browser poll error:", error)`).
- No logger abstraction. The browser console is the only output channel.
- `console.debug` is appropriate here: it appears in browser devtools when "Verbose" / "Debug" level is enabled, but is hidden by default.

**Server-side (`trafficRelay.ts`):**
- Uses an injectable `log` object typed as `Pick<Console, "log" | "warn">` (line 43).
- The `createTrafficRelayApp` function accepts `options.log` and defaults to `console`.
- Tests inject `quietLog = { log: () => undefined, warn: () => undefined }` to suppress output.
- `console.debug` is not currently part of the `log` interface. Adding it requires extending the type to `Pick<Console, "log" | "warn" | "debug">`.

### Proposed Change

**Client-side (`trafficClient.ts:341`):**

```ts
} catch (error) {
  console.debug("[ship-relay] failed to parse message:", error);
}
```

Simple `console.debug` call. No interface changes needed. Hidden by default in browser devtools.

**Server-side (`trafficRelay.ts:116`, `trafficRelay.ts:212-213`):**

1. Extend the `log` type from `Pick<Console, "log" | "warn">` to `Pick<Console, "log" | "warn" | "debug">`.
2. Update the `quietLog` in `trafficRelay.test.ts` to include `debug: () => undefined`.
3. Add debug calls:

At line 116:
```ts
} catch (error) {
  log.debug("[aisstream] failed to parse ship feed message:", error);
}
```

At line 212-213:
```ts
} catch (error) {
  log.debug("[relay] failed to parse client message:", error);
}
```

**Why `debug` and not `warn`?**

These catch blocks fire for every malformed message from external sources. A misbehaving AISStream feed or a browser extension injecting garbage could generate hundreds of warnings per minute. `debug` level ensures these are visible only when explicitly requested (Node `--inspect`, browser devtools verbose mode), keeping production logs clean.

### Risks

- **Very low.** Adding a `console.debug` / `log.debug` call to an existing catch block is the smallest possible change.
- The type extension from `Pick<Console, "log" | "warn">` to `Pick<Console, "log" | "warn" | "debug">` is backward-compatible: any object that already has `debug` (like the real `console`) satisfies it. Objects that don't (like the test `quietLog`) need a one-line addition.
- No behavior change in production; these messages are invisible unless debug logging is enabled.

### Test Plan

- **Server-side: verify `log.debug` is called on malformed input.**
  In `trafficRelay.test.ts`, create a spy logger `{ log: vi.fn(), warn: vi.fn(), debug: vi.fn() }`. Send a malformed (non-JSON) message to `handleShipFeedMessage` via a fake ship socket. Assert `debug` was called once with a message containing `"failed to parse"`.

- **Server-side: verify `log.debug` is called on malformed client subscribe.**
  Same spy logger. Connect a client and emit a non-JSON message. Assert `debug` was called.

- **Client-side: verify `console.debug` is called on malformed relay message.**
  In `trafficClient.test.ts`, spy on `console.debug`. Open a mock WebSocket, emit a `message` event with non-JSON data. Assert `console.debug` was called. Verify the client otherwise continues operating normally (no crash, still connected).

- **Existing tests pass.** The `quietLog` update is the only mechanical change to existing tests.

---

## Implementation Order

1. **Item 3 (debug logging)** -- smallest, no logic changes, just instrumentation. Builds familiarity with the catch sites.
2. **Item 1 (`any` to `unknown`)** -- type-only refactor with existing test coverage.
3. **Item 2 (retry backoff)** -- most logic; benefits from having the debug logging in place for development.

Each item is independently shippable as a single commit.
