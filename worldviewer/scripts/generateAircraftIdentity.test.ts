import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatShardSizeLine,
  generateAircraftIdentity,
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
});
