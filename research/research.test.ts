import { describe, expect, it } from "vitest";
import {
  analyzeMeasurements,
  measurementColumns,
  measurementCsvRow,
  parseCsv,
  parseMeasurements,
  validateMeasurement,
  wilson,
} from "./field-analysis.js";
import { ndefUriSize } from "./ndef.js";

describe("NDEF capacity", () => {
  it("matches the exact 64-byte Type 2 example in the manuscript", () => {
    expect(
      ndefUriSize("https://store.example.com/u/019535d9-3df7-79fb-b466-fa907fa17f9e"),
    ).toMatchObject({
      uriBytes: 64,
      payloadBytes: 57,
      recordBytes: 61,
      totalBytes: 64,
      freeBytes: 80,
      fits: true,
    });
  });
  it("counts UTF-8 bytes and extended record/TLV lengths", () => {
    const size = ndefUriSize(`https://example.com/${"a".repeat(250)}`);
    expect(size.recordBytes).toBe(size.payloadBytes + 7);
    expect(size.totalBytes).toBe(size.recordBytes + 5);
    expect(size.fits).toBe(false);
    expect(ndefUriSize("https://example.com/é").uriBytes).toBe(22);
  });
  it("rejects unsupported carriers and impossible capacities", () => {
    expect(() => ndefUriSize("javascript:alert(1)")).toThrow();
    expect(() => ndefUriSize("https://example.com", -1)).toThrow();
  });
});

describe("field measurements", () => {
  it("round-trips quoted multiline conditions and escaped quotes", () => {
    const measurement = validateMeasurement({
      condition: 'steel, "cold"\ncase',
      phone: "P1",
      tag: "T1",
      material: "metal",
      carrier: "NFC",
      success: true,
      latency_ms: 125,
    });
    const csv = measurementColumns.join(",") + "\r\n" + measurementCsvRow(measurement);
    expect(parseMeasurements(csv)).toEqual([measurement]);
    expect(() => parseCsv('"unfinished')).toThrow();
    expect(() => parseCsv('"done"junk')).toThrow();
  });
  it("uses all attempts for reliability and successful attempts for latency", () => {
    const base = {
      condition: "A",
      phone: "P1",
      tag: "T1",
      material: "paper",
      carrier: "NFC" as const,
    };
    const measurements = [
      validateMeasurement({ ...base, success: true, latency_ms: 100 }),
      validateMeasurement({ ...base, success: true, latency_ms: 300 }),
      validateMeasurement({ ...base, success: false, latency_ms: null }),
    ];
    expect(analyzeMeasurements(measurements)[0]).toMatchObject({
      trials: 3,
      successes: 2,
      success_rate: 2 / 3,
      mean_latency_ms: 200,
      p95_latency_ms: 300,
      meets_100_trial_minimum: false,
    });
  });
  it("computes Wilson intervals including boundary counts", () => {
    expect(wilson(0, 100)[0]).toBeCloseTo(0);
    expect(wilson(100, 100)[0]).toBeCloseTo(0.963005, 5);
    expect(wilson(100, 100)[1]).toBeCloseTo(1);
    expect(() => wilson(2, 1)).toThrow();
  });
  it("rejects malformed measurements instead of silently dropping them", () => {
    const header = measurementColumns.join(",") + "\n";
    expect(() => parseMeasurements(header + "A,P1,T1,paper,NFC,true,\n")).toThrow();
    expect(() => parseMeasurements(header + "A,P1,T1,paper,NFC,true,NaN\n")).toThrow();
    expect(() => parseMeasurements(header + "A,P1,T1,paper,NFC,yes,100\n")).toThrow();
  });
});
