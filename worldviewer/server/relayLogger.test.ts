import { describe, expect, it } from "vitest";
import { createRelayLogger, nextClientId } from "./relayLogger";

describe("createRelayLogger", () => {
  it("log() outputs JSON with ts, level 'info', and msg", () => {
    const lines: string[] = [];
    const logger = createRelayLogger((line) => lines.push(line));

    logger.log("hello world");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello world");
    expect(entry.ts).toBeDefined();
  });

  it("warn() outputs JSON with level 'warn'", () => {
    const lines: string[] = [];
    const logger = createRelayLogger((line) => lines.push(line));

    logger.warn("something broke");

    const entry = JSON.parse(lines[0]);
    expect(entry.level).toBe("warn");
    expect(entry.msg).toBe("something broke");
  });

  it("joins multiple arguments with spaces", () => {
    const lines: string[] = [];
    const logger = createRelayLogger((line) => lines.push(line));

    logger.log("count:", 42, "items");

    const entry = JSON.parse(lines[0]);
    expect(entry.msg).toBe("count: 42 items");
  });

  it("outputs valid JSON terminated with newline", () => {
    const lines: string[] = [];
    const logger = createRelayLogger((line) => lines.push(line));

    logger.log("test");

    expect(lines[0].endsWith("\n")).toBe(true);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it("timestamp is ISO 8601 format", () => {
    const lines: string[] = [];
    const logger = createRelayLogger((line) => lines.push(line));

    logger.log("ts check");

    const entry = JSON.parse(lines[0]);
    const parsed = new Date(entry.ts);
    expect(parsed.toISOString()).toBe(entry.ts);
  });

  it("debug() is a no-op that produces no output", () => {
    const lines: string[] = [];
    const logger = createRelayLogger((line) => lines.push(line));

    logger.debug("should be silent");

    expect(lines).toHaveLength(0);
  });
});

describe("nextClientId", () => {
  it("returns incrementing numbers", () => {
    const a = nextClientId();
    const b = nextClientId();
    const c = nextClientId();

    expect(b).toBe(a + 1);
    expect(c).toBe(b + 1);
  });
});
