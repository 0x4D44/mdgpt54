export type AircraftIdentity = {
  registration: string | null;
  typeCode: string | null;
  manufacturer: string | null;
  model: string | null;
};

export type AircraftIdentityTuple = [
  registration: string | null,
  typeCode: string | null,
  manufacturer: string | null,
  model: string | null
];

export type AircraftIdentityShard = Record<string, AircraftIdentityTuple>;

const HEX_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"] as const;

export const AIRCRAFT_IDENTITY_PREFIXES = HEX_DIGITS.flatMap((first) =>
  HEX_DIGITS.map((second) => `${first}${second}`)
);

const ICAO24_RE = /^[0-9a-f]{6}$/;
const RENDER_MODEL_KEYS: Record<string, string> = {
  A318: "airbus-a320-family",
  A319: "airbus-a320-family",
  A320: "airbus-a320-family",
  A321: "airbus-a320-family",
  A20N: "airbus-a320-family",
  A21N: "airbus-a320-family",
  B733: "boeing-737-family",
  B734: "boeing-737-family",
  B735: "boeing-737-family",
  B736: "boeing-737-family",
  B737: "boeing-737-family",
  B738: "boeing-737-family",
  B739: "boeing-737-family",
  B37M: "boeing-737-family",
  B38M: "boeing-737-family",
  B39M: "boeing-737-family",
  B3XM: "boeing-737-family",
  B772: "boeing-777-family",
  B773: "boeing-777-family",
  B77F: "boeing-777-family",
  B77L: "boeing-777-family",
  B77W: "boeing-777-family",
  B788: "boeing-787-family",
  B789: "boeing-787-family",
  B78X: "boeing-787-family"
};

export function normalizeAircraftIdentityText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeAircraftTypeCode(value: unknown): string | null {
  const normalized = normalizeAircraftIdentityText(value);
  return normalized ? normalized.toUpperCase() : null;
}

export function normalizeAircraftIcao24(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return ICAO24_RE.test(normalized) ? normalized : null;
}

export function getAircraftIdentityPrefix(value: unknown): string | null {
  const normalized = normalizeAircraftIcao24(value);
  return normalized ? normalized.slice(0, 2) : null;
}

export function createAircraftIdentityTuple(fields: {
  registration?: unknown;
  typeCode?: unknown;
  manufacturer?: unknown;
  model?: unknown;
}): AircraftIdentityTuple | null {
  const registration = normalizeAircraftIdentityText(fields.registration);
  const typeCode = normalizeAircraftTypeCode(fields.typeCode);
  const manufacturer = normalizeAircraftIdentityText(fields.manufacturer);
  const model = normalizeAircraftIdentityText(fields.model);

  if (!registration && !typeCode && !manufacturer && !model) {
    return null;
  }

  return [registration, typeCode, manufacturer, model];
}

export function expandAircraftIdentityTuple(value: unknown): AircraftIdentity | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const tuple = createAircraftIdentityTuple({
    registration: value[0],
    typeCode: value[1],
    manufacturer: value[2],
    model: value[3]
  });
  if (!tuple) {
    return null;
  }

  const [registration, typeCode, manufacturer, model] = tuple;
  return {
    registration,
    typeCode,
    manufacturer,
    model
  };
}

export function parseAircraftIdentityShard(value: unknown): Record<string, AircraftIdentity> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const shard: Record<string, AircraftIdentity> = {};
  for (const [icao24, tuple] of Object.entries(value as Record<string, unknown>)) {
    const normalizedIcao24 = normalizeAircraftIcao24(icao24);
    const identity = expandAircraftIdentityTuple(tuple);
    if (!normalizedIcao24 || !identity) {
      continue;
    }

    shard[normalizedIcao24] = identity;
  }

  return shard;
}

export function serializeAircraftIdentityShard(shard: AircraftIdentityShard): string {
  const sortedEntries = Object.entries(shard).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

export function parseAircraftDatabaseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoteChar: '"' | "'" | null = null;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];

    if (quoteChar) {
      if (char === quoteChar) {
        if (line[index + 1] === quoteChar) {
          current += quoteChar;
          index++;
        } else {
          quoteChar = null;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === ",") {
      fields.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "'" || char === '"') && current.length === 0) {
      quoteChar = char;
      continue;
    }

    if (char === "\r") {
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

export function buildAircraftDatabaseHeaderIndex(fields: string[]): Map<string, number> {
  return new Map(fields.map((field, index) => [field.trim().toLowerCase(), index]));
}

export function extractAircraftIdentityEntry(
  fields: string[],
  headerIndex: Map<string, number>
): { icao24: string; prefix: string; identity: AircraftIdentityTuple } | null {
  const icao24 = normalizeAircraftIcao24(readIndexedField(fields, headerIndex, "icao24"));
  const prefix = getAircraftIdentityPrefix(icao24);
  const identity = createAircraftIdentityTuple({
    registration: readIndexedField(fields, headerIndex, "registration"),
    typeCode: readIndexedField(fields, headerIndex, "typecode"),
    manufacturer: readIndexedField(fields, headerIndex, "manufacturername"),
    model: readIndexedField(fields, headerIndex, "model")
  });

  if (!icao24 || !prefix || !identity) {
    return null;
  }

  return {
    icao24,
    prefix,
    identity
  };
}

export function deriveRenderModelKey(typeCode: string | null | undefined): string | null {
  const normalized = normalizeAircraftTypeCode(typeCode);
  if (!normalized) {
    return null;
  }

  return RENDER_MODEL_KEYS[normalized] ?? null;
}

export function formatAircraftModelDescription(
  manufacturer: string | null | undefined,
  model: string | null | undefined
): string | null {
  const normalizedManufacturer = normalizeAircraftIdentityText(manufacturer);
  const normalizedModel = normalizeAircraftIdentityText(model);

  if (normalizedManufacturer && normalizedModel) {
    if (normalizedModel.toLowerCase().startsWith(normalizedManufacturer.toLowerCase())) {
      return normalizedModel;
    }

    return `${normalizedManufacturer} ${normalizedModel}`;
  }

  return normalizedManufacturer ?? normalizedModel;
}

function readIndexedField(fields: string[], headerIndex: Map<string, number>, name: string): string | null {
  const index = headerIndex.get(name);
  if (index === undefined) {
    return null;
  }

  return fields[index] ?? null;
}
