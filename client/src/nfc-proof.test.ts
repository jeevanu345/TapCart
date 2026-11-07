import { describe, it, expect } from "vitest";
import { tapProof, unitLink } from "./nfc-proof";
const id = "11111111-1111-4111-8111-111111111111",
  origin = "https://store.example";
describe("authenticated NFC link preservation", () => {
  it("preserves NXP ctr ASCII mirror through scan input navigation", () => {
    const path = `/u/${id}?uid=04DE5F1EACC040&ctr=00003D&mac=94eed9ee65337086`;
    expect(unitLink(origin + path, origin)).toBe(path);
    expect(tapProof(new URL(unitLink(origin + path, origin), origin))).toEqual({
      uid: "04DE5F1EACC040",
      counter: "00003D",
      mac: "94eed9ee65337086",
    });
  });
  it("supports static links and rejects a different origin", () => {
    expect(unitLink(id, origin)).toBe(`/u/${id}`);
    expect(tapProof(new URL(`/u/${id}`, origin))).toBeUndefined();
    expect(() => unitLink(`https://evil.example/u/${id}`, origin)).toThrow();
  });
  it("forwards malformed incomplete proofs for authoritative rejection and supports counter alias", () => {
    expect(tapProof(new URL(`/u/${id}?mac=bad`, origin))).toEqual({
      uid: "",
      counter: "",
      mac: "bad",
    });
    expect(tapProof(new URL(`/u/${id}?counter=00003D`, origin))?.counter).toBe("00003D");
  });
});
