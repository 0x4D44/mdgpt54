import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatShardSizeLine,
  generateAircraftIdentity,
  isAircraftIdentityGeneratorEntrypoint,
  parseGeneratorArgs
} from "./generateAircraftIdentity";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "worldviewer-aircraft-"));
  tempRoots.push(root);
  return root;
}

describe("generateAircraftIdentity", () => {
  it("writes two-hex shards and prunes stale shard files", async () => {
    const root = await makeTempRoot();
    const inputPath = join(root, "aircraft.csv");
    const outputDir = join(root, "aircraft-identity");

    await mkdir(outputDir, { recursive: true });
    await writeFile(
      inputPath,
      [
        "icao24,registration,typecode,manufacturername,model",
        "abcd12,N123AB,B738,Boeing,737-800",
        "00ff10,G-TEST,A20N,Airbus,A320neo"
      ].join("\n"),
      "utf8"
    );
    await writeFile(join(outputDir, "stale.json"), "{}", "utf8");

    const summaries = await generateAircraftIdentity({ inputPath, outputDir });

    expect(summaries).toHaveLength(256);
    expect(JSON.parse(await readFile(join(outputDir, "ab.json"), "utf8"))).toEqual({
      abcd12: ["N123AB", "B738", "Boeing", "737-800"]
    });
    expect(JSON.parse(await readFile(join(outputDir, "00.json"), "utf8"))).toEqual({
      "00ff10": ["G-TEST", "A20N", "Airbus", "A320neo"]
    });
    await expect(access(join(outputDir, "stale.json"))).rejects.toThrow();
  });

  it("skips rows with invalid ICAO24 values", async () => {
    const root = await makeTempRoot();
    const inputPath = join(root, "aircraft.csv");
    const outputDir = join(root, "aircraft-identity");

    await writeFile(
      inputPath,
      [
        "icao24,registration,typecode,manufacturername,model",
        "INVALID,N123AB,B738,Boeing,737-800",
        "aabb00,N200,A320,Airbus,A320"
      ].join("\n"),
      "utf8"
    );

    const summaries = await generateAircraftIdentity({ inputPath, outputDir });

    const aaSummary = summaries.find((s) => s.prefix === "aa")!;
    expect(aaSummary.entries).toBe(1);
  });

  it("accepts output directory paths with trailing slashes", async () => {
    const root = await makeTempRoot();
    const inputPath = join(root, "aircraft.csv");
    const outputDir = join(root, "aircraft-identity") + "/";

    await writeFile(inputPath, "icao24,registration,typecode,manufacturername,model\n", "utf8");

    const summaries = await generateAircraftIdentity({ inputPath, outputDir });
    expect(summaries).toHaveLength(256);
  });

  it("preserves non-JSON files and directories during shard pruning", async () => {
    const root = await makeTempRoot();
    const inputPath = join(root, "aircraft.csv");
    const outputDir = join(root, "aircraft-identity");

    await mkdir(outputDir, { recursive: true });
    await writeFile(inputPath, "icao24,registration,typecode,manufacturername,model\n", "utf8");
    await writeFile(join(outputDir, "readme.txt"), "keep me", "utf8");
    await mkdir(join(outputDir, "subdir"), { recursive: true });

    await generateAircraftIdentity({ inputPath, outputDir });

    await expect(access(join(outputDir, "readme.txt"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "subdir"))).resolves.toBeUndefined();
  });

  it("rejects output directories that are not explicitly aircraft-identity", async () => {
    const root = await makeTempRoot();
    const inputPath = join(root, "aircraft.csv");
    const outputDir = join(root, "wrong-output");

    await writeFile(
      inputPath,
      [
        "icao24,registration,typecode,manufacturername,model",
        "abcd12,N123AB,B738,Boeing,737-800"
      ].join("\n"),
      "utf8"
    );

    await expect(generateAircraftIdentity({ inputPath, outputDir })).rejects.toThrow(
      'Output directory must end with "aircraft-identity"'
    );
  });
});

describe("parseGeneratorArgs", () => {
  it("parses explicit input and output flags", () => {
    expect(parseGeneratorArgs(["--input", "tmp/aircraft.csv", "--output", "public/aircraft-identity"])).toEqual({
      inputPath: "tmp/aircraft.csv",
      outputDir: "public/aircraft-identity"
    });
  });

  it("falls back to the default output directory", () => {
    expect(parseGeneratorArgs(["tmp/aircraft.csv"])).toEqual({
      inputPath: "tmp/aircraft.csv",
      outputDir: "public/aircraft-identity"
    });
  });

  it("accepts short flags -i and -o", () => {
    expect(parseGeneratorArgs(["-i", "data/db.csv", "-o", "out/aircraft-identity"])).toEqual({
      inputPath: "data/db.csv",
      outputDir: "out/aircraft-identity"
    });
  });

  it("throws when no input path is provided", () => {
    expect(() => parseGeneratorArgs([])).toThrow("Missing input CSV path");
  });

  it("throws when only flags are provided without values", () => {
    expect(() => parseGeneratorArgs(["--output", "out/aircraft-identity"])).toThrow("Missing input CSV path");
  });

  it("ignores unrecognized flags", () => {
    expect(parseGeneratorArgs(["--verbose", "--input", "db.csv"])).toEqual({
      inputPath: "db.csv",
      outputDir: "public/aircraft-identity"
    });
  });
});

describe("formatShardSizeLine", () => {
  it("marks shards that exceed the warning thresholds", () => {
    expect(
      formatShardSizeLine({
        prefix: "ab",
        entries: 1234,
        rawBytes: 6 * 1024 * 1024,
        gzipBytes: 2 * 1024 * 1024
      })
    ).toContain("[warning]");
  });

  it("omits warning for shards within size limits", () => {
    const line = formatShardSizeLine({
      prefix: "0a",
      entries: 42,
      rawBytes: 512,
      gzipBytes: 200
    });
    expect(line).not.toContain("[warning]");
    expect(line).toContain("0a.json");
    expect(line).toContain("42 entries");
    expect(line).toContain("512 B raw");
    expect(line).toContain("200 B gzip");
  });

  it("formats KiB-range byte sizes", () => {
    const line = formatShardSizeLine({
      prefix: "ff",
      entries: 100,
      rawBytes: 150 * 1024,
      gzipBytes: 50 * 1024
    });
    expect(line).toContain("150.0 KiB raw");
    expect(line).toContain("50.0 KiB gzip");
  });

  it("formats MiB-range byte sizes", () => {
    const line = formatShardSizeLine({
      prefix: "cd",
      entries: 5000,
      rawBytes: 3 * 1024 * 1024,
      gzipBytes: 1024 * 1024
    });
    expect(line).toContain("3.00 MiB raw");
    expect(line).toContain("1.00 MiB gzip");
  });

  it("warns when only raw bytes exceed the threshold", () => {
    const line = formatShardSizeLine({
      prefix: "aa",
      entries: 100,
      rawBytes: 6 * 1024 * 1024,
      gzipBytes: 1024
    });
    expect(line).toContain("[warning]");
  });

  it("warns when only gzip bytes exceed the threshold", () => {
    const line = formatShardSizeLine({
      prefix: "bb",
      entries: 100,
      rawBytes: 1024,
      gzipBytes: 2 * 1024 * 1024
    });
    expect(line).toContain("[warning]");
  });
});

describe("isAircraftIdentityGeneratorEntrypoint", () => {
  it("returns true for a .ts script path", () => {
    expect(isAircraftIdentityGeneratorEntrypoint("scripts/generateAircraftIdentity.ts")).toBe(true);
  });

  it("returns true for a .js script path", () => {
    expect(isAircraftIdentityGeneratorEntrypoint("dist/generateAircraftIdentity.js")).toBe(true);
  });

  it("returns false for an unrelated script", () => {
    expect(isAircraftIdentityGeneratorEntrypoint("scripts/otherScript.ts")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAircraftIdentityGeneratorEntrypoint(undefined)).toBe(false);
  });
});

describe("CLI entrypoint", () => {
  let savedArgv: string[];

  beforeEach(() => {
    savedArgv = [...process.argv];
  });

  afterEach(() => {
    process.argv = savedArgv;
    vi.restoreAllMocks();
  });

  it("main() generates shards and logs output when invoked as entrypoint", async () => {
    const root = await makeTempRoot();
    const inputPath = join(root, "aircraft.csv");
    const outputDir = join(root, "aircraft-identity");

    await writeFile(
      inputPath,
      ["icao24,registration,typecode,manufacturername,model", "aabb00,N100,B738,Boeing,737-800"].join("\n"),
      "utf8"
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    process.argv = ["node", "generateAircraftIdentity.ts", "--input", inputPath, "--output", outputDir];
    vi.resetModules();
    await import("./generateAircraftIdentity");

    // Allow the async main() to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Generated 256 aircraft identity shards"));
    await expect(access(join(outputDir, "aa.json"))).resolves.toBeUndefined();
  });

  it("entrypoint catch handler logs error and sets exitCode on failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    process.argv = ["node", "generateAircraftIdentity.ts", "--input", "/nonexistent/path.csv", "--output", "aircraft-identity"];
    vi.resetModules();
    await import("./generateAircraftIdentity");

    // Allow the async main().catch() to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(errorSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    // Clean up exitCode to not affect other tests
    process.exitCode = undefined;
  });
});
