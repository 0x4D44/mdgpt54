import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatShardSizeLine,
  generateAircraftIdentity,
  isAircraftIdentityGeneratorEntrypoint,
  parseGeneratorArgs
} from "./generateAircraftIdentity";

const tempDirs: string[] = [];

describe("generateAircraftIdentity", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("writes compact Step 2 shards from a complete snapshot CSV sample", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worldviewer-aircraft-identity-"));
    tempDirs.push(tempDir);

    const inputPath = join(tempDir, "aircraft.csv");
    const outputDir = join(tempDir, "aircraft-identity");

    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "a.json"), '{"legacy":true}', "utf8");

    await writeFile(
      inputPath,
      [
        "'icao24','registration','typeCode','manufacturerName','model'",
        "'ABC123','N123AB','B738','Boeing','737-800'",
        "'f0c456','G-ABCD','A20N','Airbus','A320neo'",
        "'abffff','','','',''",
        "'badrow','','','',''"
      ].join("\n"),
      "utf8"
    );

    const summaries = await generateAircraftIdentity({ inputPath, outputDir });
    const generatedFiles = await readdir(outputDir);
    const abShard = JSON.parse(await readFile(join(outputDir, "ab.json"), "utf8")) as Record<string, unknown>;
    const f0Shard = JSON.parse(await readFile(join(outputDir, "f0.json"), "utf8")) as Record<string, unknown>;

    expect(summaries).toHaveLength(256);
    expect(generatedFiles).not.toContain("a.json");
    expect(abShard).toEqual({
      abc123: ["N123AB", "B738", "Boeing", "737-800"]
    });
    expect(f0Shard).toEqual({
      f0c456: ["G-ABCD", "A20N", "Airbus", "A320neo"]
    });
  });

  it("rejects output directories outside the dedicated aircraft-identity folder", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "worldviewer-aircraft-identity-"));
    tempDirs.push(tempDir);

    const inputPath = join(tempDir, "aircraft.csv");
    const outputDir = join(tempDir, "public");

    await writeFile(inputPath, ["'icao24','registration'", "'abc123','N123AB'"].join("\n"), "utf8");

    await expect(generateAircraftIdentity({ inputPath, outputDir })).rejects.toThrow(
      'Output directory must end with "aircraft-identity"'
    );
  });
});

describe("isAircraftIdentityGeneratorEntrypoint", () => {
  it("matches both ts and js execution paths", () => {
    expect(isAircraftIdentityGeneratorEntrypoint("C:\\repo\\scripts\\generateAircraftIdentity.ts")).toBe(true);
    expect(isAircraftIdentityGeneratorEntrypoint("/repo/scripts/generateAircraftIdentity.js")).toBe(true);
    expect(isAircraftIdentityGeneratorEntrypoint("/repo/scripts/otherScript.js")).toBe(false);
    expect(isAircraftIdentityGeneratorEntrypoint(undefined)).toBe(false);
  });
});

describe("parseGeneratorArgs", () => {
  it("accepts explicit input and output flags", () => {
    expect(parseGeneratorArgs(["--input", "tmp/input.csv", "--output", "public/aircraft-identity"])).toEqual({
      inputPath: "tmp/input.csv",
      outputDir: "public/aircraft-identity"
    });
  });
});

describe("formatShardSizeLine", () => {
  it("formats shard size lines with warnings when thresholds are exceeded", () => {
    expect(
      formatShardSizeLine({
        prefix: "ab",
        entries: 1,
        rawBytes: 6 * 1024 * 1024,
        gzipBytes: 2 * 1024 * 1024
      })
    ).toContain("[warning]");
  });
});
