import { describe, it, expect } from "vitest";
import {
  calculateSdmMac,
  deriveSdmMacKey,
  encryptTagKey,
  decryptTagKey,
  masterKey,
  enforceTagPolicy,
  verifyTagForUnit,
} from "../nfc/authenticated.js";
import { summarizeTrials } from "../nfc/measurements.js";
import { randomBytes } from "node:crypto";
import type { Database } from "../db.js";
describe("NXP NTAG424 SDM AES vectors and fail-closed policy", () => {
  const key = Buffer.alloc(16),
    uid = Buffer.from("04DE5F1EACC040", "hex"),
    counter = Buffer.from("3D0000", "hex");
  it("matches official AN12196 rev2 Table4 session key", async () => {
    expect((await deriveSdmMacKey(key, uid, counter)).toString("hex")).toBe(
      "3fb5f6e3a807a03d5e3570ace393776f",
    );
  });
  it("matches official AN12196 rev2 Table4 zero-input truncated CMAC", async () => {
    expect((await calculateSdmMac(key, uid, counter)).toString("hex")).toBe("94eed9ee65337086");
  });
  it("matches official AN12196 rev2 Table5 nonempty-input vector", async () => {
    expect(
      (
        await calculateSdmMac(
          key,
          Buffer.from("04958CAA5C5E80", "hex"),
          Buffer.from("080000", "hex"),
          Buffer.from("CEE9A53E3E463EF1F459635736738962&cmac="),
        )
      ).toString("hex"),
    ).toBe("ecc1e7f6c6c73bf6");
  });
  it("authenticates encrypted key storage to tenant, unit and UID", () => {
    const master = randomBytes(32),
      tag = randomBytes(16),
      encrypted = encryptTagKey(tag, master, "tenant:unit:uid");
    expect(decryptTagKey(encrypted, master, "tenant:unit:uid")).toEqual(tag);
    expect(() => decryptTagKey(encrypted, master, "other:unit:uid")).toThrow();
    expect(encrypted).not.toContain(tag.toString("hex"));
  });
  it("requires a complete operator-managed master key", () => {
    expect(() => masterKey(undefined)).toThrow();
    expect(() => masterKey("00")).toThrow();
  });
  const fake = (rows: unknown[]) =>
    ({ query: async () => ({ rows, rowCount: rows.length }) }) as Pick<Database, "query">;
  it("rejects unknown required-tag policies", async () => {
    await expect(
      enforceTagPolicy(fake([{ nfc_policy: "FUTURE_UNKNOWN" }]), "unit"),
    ).rejects.toThrow("fresh authenticated");
  });
  it("rejects missing required proofs", async () => {
    await expect(enforceTagPolicy(fake([{ nfc_policy: "NTAG424_SDM" }]), "unit")).rejects.toThrow(
      "fresh authenticated",
    );
  });
  it("permits explicitly static unit policy", async () => {
    expect(await enforceTagPolicy(fake([{ nfc_policy: "STATIC" }]), "unit")).toBeNull();
  });
  it("rejects malformed proof before any key lookup", async () => {
    await expect(
      verifyTagForUnit(fake([]), "unit", { uid: "x", counter: "000000", mac: "00" }),
    ).rejects.toThrow("Malformed");
  });
});

it("includes physical read failures in the reliability denominator and Wilson interval", () => {
  const base = {
    device: "Android Chrome",
    tag: "NTAG213",
    material: "cardboard",
    carrier: "NFC" as const,
  };
  const result = summarizeTrials([
    { ...base, outcome: "SUCCESS", browser_uri_ms: 200, reservation_ms: 10 },
    { ...base, outcome: "READ_FAILURE", browser_uri_ms: null, reservation_ms: null },
  ])[0]!;
  expect(result.trials).toBe(2);
  expect(result.successRate).toBe(0.5);
  expect(result.failureOutcomes).toEqual({ READ_FAILURE: 1 });
  expect(result.wilson95[0]).toBeCloseTo(0.0945, 3);
  expect(result.wilson95[1]).toBeCloseTo(0.9055, 3);
});

it("converts actual MSB-first ASCII counter mirror to the official NXP LE crypto context", async () => {
  const master = randomBytes(32),
    unitId = "unit",
    storeId = "store",
    uid = "04DE5F1EACC040";
  let acceptedCounter: number | undefined;
  const db = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM inventory_unit"))
        return { rows: [{ store_id: storeId, nfc_policy: "NTAG424_SDM" }], rowCount: 1 };
      if (sql.startsWith("SELECT"))
        return {
          rows: [
            {
              uid,
              store_id: storeId,
              scheme: "NTAG424_SDM_AES_PLAIN_EMPTY_MAC",
              encrypted_key: encryptTagKey(Buffer.alloc(16), master, `${storeId}:${unitId}:${uid}`),
            },
          ],
          rowCount: 1,
        };
      acceptedCounter = values?.[1] as number;
      return { rows: [{ unit_id: unitId }], rowCount: 1 };
    },
  } as Pick<Database, "query">;
  const verified = await verifyTagForUnit(
    db,
    unitId,
    { uid, counter: "00003D", mac: "94EED9EE65337086" },
    master.toString("hex"),
  );
  expect(verified.counter).toBe(61);
  expect(acceptedCounter).toBe(61);
});
