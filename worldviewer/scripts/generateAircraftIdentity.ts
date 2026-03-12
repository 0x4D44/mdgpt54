import { createReadStream } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";

import {
  AIRCRAFT_IDENTITY_PREFIXES,
  buildAircraftDatabaseHeaderIndex,
  extractAircraftIdentityEntry,
  parseAircraftDatabaseCsvLine,
  serializeAircraftIdentityShard,
  type AircraftIdentityShard
} from "../src/traffic/aircraftIdentityData";

const RAW_WARNING_BYTES = 5 * 1024 * 1024;
const GZIP_WARNING_BYTES = Math.round(1.5 * 1024 * 1024);
const DEFAULT_OUTPUT_DIR = "public/aircraft-identity";
const REQUIRED_OUTPUT_DIR_NAME = "aircraft-identity";

type GeneratorOptions = {
  inputPath: string;
  outputDir: string;
};

type ShardSizeSummary = {
  prefix: string;
  entries: number;
  rawBytes: number;
  gzipBytes: number;
};

export async function generateAircraftIdentity(options: GeneratorOptions): Promise<ShardSizeSummary[]> {
  assertAircraftIdentityOutputDir(options.outputDir);

  const shards = new Map<string, AircraftIdentityShard>(
    AIRCRAFT_IDENTITY_PREFIXES.map((prefix) => [prefix, {} satisfies AircraftIdentityShard])
  );

  const reader = createInterface({
    input: createReadStream(options.inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let headerIndex: Map<string, number> | null = null;

  for await (const line of reader) {
    if (!headerIndex) {
      headerIndex = buildAircraftDatabaseHeaderIndex(parseAircraftDatabaseCsvLine(line));
      continue;
    }

    const entry = extractAircraftIdentityEntry(parseAircraftDatabaseCsvLine(line), headerIndex);
    if (!entry) {
      continue;
    }

    const shard = shards.get(entry.prefix);
    if (!shard) {
      continue;
    }

    shard[entry.icao24] = entry.identity;
  }

  await mkdir(options.outputDir, { recursive: true });
  await pruneStaleShardFiles(options.outputDir);

  const summaries: ShardSizeSummary[] = [];
  for (const prefix of AIRCRAFT_IDENTITY_PREFIXES) {
    const shard = shards.get(prefix)!;
    const json = serializeAircraftIdentityShard(shard);
    const rawBytes = Buffer.byteLength(json);
    const gzipBytes = gzipSync(Buffer.from(json), { level: 9 }).byteLength;

    await writeFile(`${options.outputDir}/${prefix}.json`, json, "utf8");
    summaries.push({
      prefix,
      entries: Object.keys(shard).length,
      rawBytes,
      gzipBytes
    });
  }

  return summaries;
}

export function parseGeneratorArgs(argv: string[]): GeneratorOptions {
  let inputPath = "";
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if ((arg === "--input" || arg === "-i") && argv[index + 1]) {
      inputPath = argv[index + 1];
      index++;
      continue;
    }

    if ((arg === "--output" || arg === "-o") && argv[index + 1]) {
      outputDir = argv[index + 1];
      index++;
      continue;
    }

    if (!arg.startsWith("-") && inputPath.length === 0) {
      inputPath = arg;
    }
  }

  if (inputPath.length === 0) {
    throw new Error("Missing input CSV path. Use --input <path>.");
  }

  return {
    inputPath,
    outputDir
  };
}

export function formatShardSizeLine(summary: ShardSizeSummary): string {
  const warning =
    summary.rawBytes > RAW_WARNING_BYTES || summary.gzipBytes > GZIP_WARNING_BYTES ? " [warning]" : "";
  return [
    `${summary.prefix}.json`,
    `${summary.entries.toLocaleString()} entries`,
    `${formatBytes(summary.rawBytes)} raw`,
    `${formatBytes(summary.gzipBytes)} gzip${warning}`
  ].join(" | ");
}

export function isAircraftIdentityGeneratorEntrypoint(scriptPath: string | undefined): boolean {
  return Boolean(scriptPath?.match(/generateAircraftIdentity\.[jt]s$/));
}

async function main(): Promise<void> {
  const options = parseGeneratorArgs(process.argv.slice(2));
  const summaries = await generateAircraftIdentity(options);

  console.log(`Generated ${summaries.length} aircraft identity shards from ${options.inputPath}`);
  for (const summary of summaries) {
    console.log(formatShardSizeLine(summary));
  }
}

if (isAircraftIdentityGeneratorEntrypoint(process.argv[1])) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

async function pruneStaleShardFiles(outputDir: string): Promise<void> {
  const expectedFiles = new Set(AIRCRAFT_IDENTITY_PREFIXES.map((prefix) => `${prefix}.json`));
  const entries = await readdir(outputDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || expectedFiles.has(entry.name)) {
      continue;
    }

    await unlink(`${outputDir}/${entry.name}`);
  }
}

function assertAircraftIdentityOutputDir(outputDir: string): void {
  const trimmed = outputDir.replace(/[\\/]+$/, "");
  const outputName = basename(trimmed);
  if (outputName === REQUIRED_OUTPUT_DIR_NAME) {
    return;
  }

  throw new Error(
    `Output directory must end with "${REQUIRED_OUTPUT_DIR_NAME}" so the generator cannot delete unrelated JSON files.`
  );
}
