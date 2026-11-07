import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { AesCmac } from "aes-cmac";
import type { Database } from "../db.js";
import { ApiError } from "../errors.js";

export interface SdmPayload {
  uid: string;
  counter: string;
  mac: string;
}
export interface VerifiedTag {
  scheme: "NTAG424_SDM";
  unitId: string;
  storeId: string;
  uid: string;
  counter: number;
}
const hex = (value: string, bytes: number) => {
  if (!new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value))
    throw new ApiError(400, "Malformed NTAG424 SDM payload.");
  return Buffer.from(value, "hex");
};
export async function deriveSdmMacKey(key: Buffer, uid: Buffer, counterLE: Buffer) {
  if (key.length !== 16 || uid.length !== 7 || counterLE.length !== 3)
    throw new Error("Invalid SDM key or context size");
  return Buffer.from(
    await new AesCmac(key).calculate(
      Buffer.concat([Buffer.from("3CC300010080", "hex"), uid, counterLE]),
    ),
  );
}
export async function calculateSdmMac(
  key: Buffer,
  uid: Buffer,
  counterLE: Buffer,
  input = Buffer.alloc(0),
) {
  const session = await deriveSdmMacKey(key, uid, counterLE);
  const full = Buffer.from(await new AesCmac(session).calculate(input));
  return Buffer.from(full.filter((_, index) => index % 2 === 1));
}
export function masterKey(value: string | undefined): Buffer {
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value))
    throw new ApiError(503, "Authenticated NFC key storage is not configured.");
  return Buffer.from(value, "hex");
}
export function encryptTagKey(key: Buffer, master: Buffer, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", master, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((x) => x.toString("hex")).join(":");
}
export function decryptTagKey(value: string, master: Buffer, context: string) {
  const [iv, tag, encrypted] = value.split(":");
  try {
    const cipher = createDecipheriv("aes-256-gcm", master, hex(iv!, 12));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(hex(tag!, 16));
    const key = Buffer.concat([cipher.update(hex(encrypted!, 16)), cipher.final()]);
    return key;
  } catch {
    throw new ApiError(503, "Authenticated NFC key cannot be decrypted.");
  }
}
/** Accept only the explicitly supported NXP AES SDM profile: plaintext UID+counter,
 * SDMMACInputOffset == SDMMACOffset. Counter string is the six ASCII hex characters mirrored MSB-first; cryptographic context uses LE. */
export async function verifyTagForUnit(
  db: Pick<Database, "query">,
  unitId: string,
  payload: SdmPayload,
  keyEncryptionKey?: string,
): Promise<VerifiedTag> {
  const uid = hex(payload.uid, 7),
    counterBytes = hex(payload.counter, 3).reverse(),
    mac = hex(payload.mac, 8);
  // Caller holds one transaction through policy check, counter acceptance and inventory mutation.
  // Always acquire inventory before tag rows, matching enrollment, to serialize policy changes.
  const unit = (
    await db.query("SELECT store_id,nfc_policy FROM inventory_unit WHERE id=$1 FOR UPDATE", [
      unitId,
    ])
  ).rows[0];
  if (!unit || unit.nfc_policy !== "NTAG424_SDM")
    throw new ApiError(403, "Authenticated tag does not match this physical unit.");
  const row = (
    await db.query("SELECT * FROM nfc_tag WHERE unit_id=$1 AND store_id=$2 FOR UPDATE", [
      unitId,
      unit.store_id,
    ])
  ).rows[0];
  if (
    !row ||
    row.scheme !== "NTAG424_SDM_AES_PLAIN_EMPTY_MAC" ||
    row.uid !== uid.toString("hex").toUpperCase()
  )
    throw new ApiError(403, "Authenticated tag does not match this physical unit.");
  const key = decryptTagKey(
    row.encrypted_key,
    masterKey(keyEncryptionKey ?? process.env.NFC_MASTER_KEY),
    `${row.store_id}:${unitId}:${row.uid}`,
  );
  const expected = await calculateSdmMac(key, uid, counterBytes);
  if (!timingSafeEqual(expected, mac)) throw new ApiError(403, "Invalid NTAG424 SDM MAC.");
  const counter = counterBytes.readUIntLE(0, 3);
  const changed = await db.query(
    "UPDATE nfc_tag SET last_counter=$2 WHERE unit_id=$1 AND last_counter<$2 RETURNING unit_id",
    [unitId, counter],
  );
  if (!changed.rowCount)
    throw new ApiError(409, "NFC payload was already used or is older than the last accepted tap.");
  return { scheme: "NTAG424_SDM", unitId, storeId: row.store_id, uid: row.uid, counter };
}
export async function enforceTagPolicy(
  db: Pick<Database, "query">,
  unitId: string,
  payload?: SdmPayload,
  keyEncryptionKey?: string,
): Promise<VerifiedTag | null> {
  const row = (
    await db.query("SELECT nfc_policy FROM inventory_unit WHERE id=$1 FOR UPDATE", [unitId])
  ).rows[0];
  if (!row) throw new ApiError(404, "Unit not found.");
  if (row.nfc_policy === "STATIC") return null;
  if (row.nfc_policy !== "NTAG424_SDM" || !payload)
    throw new ApiError(403, "A fresh authenticated NFC tap is required.");
  return verifyTagForUnit(db, unitId, payload, keyEncryptionKey);
}
