import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export type Measurement = {
  condition: string;
  phone: string;
  tag: string;
  material: string;
  carrier: "NFC" | "QR";
  success: boolean;
  latency_ms: number | null;
};

export const measurementColumns = [
  "condition",
  "phone",
  "tag",
  "material",
  "carrier",
  "success",
  "latency_ms",
] as const;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const finishField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
  };
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (char === ",") finishField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      finishRow();
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (closed || char === '"') throw new Error("Malformed CSV quoting");
    else field += char;
  }
  if (quoted) throw new Error("Unterminated CSV quoted field");
  if (field !== "" || row.length > 0 || closed) finishRow();
  return rows;
}

export function validateMeasurement(value: unknown): Measurement {
  if (!value || typeof value !== "object") throw new Error("Measurement must be an object");
  const record = value as Record<string, unknown>;
  const strings = ["condition", "phone", "tag", "material"] as const;
  for (const key of strings) {
    if (typeof record[key] !== "string" || !record[key].trim() || record[key].length > 200)
      throw new Error(`Invalid ${key}`);
  }
  if (record.carrier !== "NFC" && record.carrier !== "QR")
    throw new Error("Carrier must be NFC or QR");
  if (typeof record.success !== "boolean") throw new Error("Success must be boolean");
  if (
    record.latency_ms !== null &&
    (typeof record.latency_ms !== "number" ||
      !Number.isFinite(record.latency_ms) ||
      record.latency_ms < 0 ||
      record.latency_ms > 3600000)
  )
    throw new Error("Invalid latency_ms");
  if (record.success && record.latency_ms === null)
    throw new Error("Successful trials require latency_ms");
  return {
    condition: String(record.condition).trim(),
    phone: String(record.phone).trim(),
    tag: String(record.tag).trim(),
    material: String(record.material).trim(),
    carrier: record.carrier,
    success: record.success,
    latency_ms: record.latency_ms as number | null,
  };
}

export function parseMeasurements(csv: string): Measurement[] {
  const rows = parseCsv(csv);
  const header = rows.shift();
  if (
    !header ||
    header.length !== measurementColumns.length ||
    header.some((value, index) => value !== measurementColumns[index])
  )
    throw new Error(`Expected header: ${measurementColumns.join(",")}`);
  if (rows.length === 0) throw new Error("No measurements");
  return rows.map((row, index) => {
    if (row.length !== measurementColumns.length || !["true", "false"].includes(row[5] ?? ""))
      throw new Error(`Invalid row ${index + 2}`);
    return validateMeasurement({
      condition: row[0],
      phone: row[1],
      tag: row[2],
      material: row[3],
      carrier: row[4],
      success: row[5] === "true",
      latency_ms: row[6] === "" ? null : Number(row[6]),
    });
  });
}

export function wilson(successes: number, trials: number): [number, number] {
  if (
    !Number.isSafeInteger(trials) ||
    !Number.isSafeInteger(successes) ||
    trials <= 0 ||
    successes < 0 ||
    successes > trials
  )
    throw new Error("Invalid success counts");
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const radius = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

export function analyzeMeasurements(measurements: Measurement[]) {
  const groups = new Map<string, Measurement[]>();
  for (const measurement of measurements) {
    const key = JSON.stringify([
      measurement.condition,
      measurement.phone,
      measurement.tag,
      measurement.material,
      measurement.carrier,
    ]);
    const group = groups.get(key) ?? [];
    group.push(measurement);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const latencies = group
      .filter((entry) => entry.success && entry.latency_ms !== null)
      .map((entry) => entry.latency_ms!)
      .sort((a, b) => a - b);
    const successes = group.filter((entry) => entry.success).length;
    return {
      condition: first.condition,
      phone: first.phone,
      tag: first.tag,
      material: first.material,
      carrier: first.carrier,
      trials: group.length,
      successes,
      success_rate: successes / group.length,
      success_wilson_95: wilson(successes, group.length),
      successful_latency_count: latencies.length,
      mean_latency_ms: latencies.length
        ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
        : null,
      p95_latency_ms: latencies.length ? latencies[Math.ceil(0.95 * latencies.length) - 1] : null,
      meets_100_trial_minimum: group.length >= 100,
    };
  });
}

export function measurementCsvRow(measurement: Measurement): string {
  return (
    [
      ...measurementColumns.map((key) => {
        const value = String(measurement[key] ?? "");
        return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      }),
    ].join(",") + "\n"
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2])
      throw new Error("Usage: npx tsx research/field-analysis.ts measurements.csv");
    console.log(
      JSON.stringify(
        analyzeMeasurements(parseMeasurements(await readFile(process.argv[2], "utf8"))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Analysis failed");
    process.exitCode = 1;
  }
}
