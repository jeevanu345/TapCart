import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function securityKey(production = process.env.NODE_ENV === "production") {
  const configured = process.env.SECURITY_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f\d]{64}$/i.test(configured))
      throw new Error(
        "SECURITY_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters.",
      );
    return Buffer.from(configured, "hex");
  }
  if (production) throw new Error("SECURITY_ENCRYPTION_KEY is required in production.");
  // Local-only fallback allows captured development mail to survive process restarts.
  return createHash("sha256").update("tapcart-local-development-only-encryption-key").digest();
}
export function encryptSecret(value: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", securityKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function decryptSecret(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret.");
  const [nonce, tag, encrypted] = parts.map((part) => Buffer.from(part!, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", securityKey(), nonce!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(encrypted!), decipher.final()]).toString("utf8");
}
