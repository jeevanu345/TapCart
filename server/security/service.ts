import { randomBytes } from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { v7 as uuid } from "uuid";
import type { PoolClient } from "pg";
import type { Database } from "../db.js";
import { hashPassword, tokenHash, verifyPassword } from "../auth.js";
import { ApiError } from "../errors.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { enqueueEmail } from "../notifications/service.js";
const opaque = () => randomBytes(32).toString("base64url");
export function transactionDatabase(db: Database, client: PoolClient): Database {
  return {
    pool: db.pool,
    query: (sql, values) => client.query(sql, values),
    transaction: (fn) => fn(client),
  };
}

const recoveryHash = (value: string) => tokenHash(value.toUpperCase().replace(/[^A-Z0-9]/g, ""));

async function issueToken(
  db: Database,
  userId: string,
  origin: string,
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
) {
  await db.transaction(async (client) => {
    const user = (
      await client.query("SELECT email,email_verified_at FROM app_user WHERE id=$1 FOR UPDATE", [
        userId,
      ])
    ).rows[0];
    if (!user || (purpose === "VERIFY_EMAIL" && user.email_verified_at)) return;
    // Bound mail flooding per account without changing public responses.
    if (
      (
        await client.query(
          "SELECT 1 FROM account_token WHERE user_id=$1 AND purpose=$2 AND created_at>now()-interval '1 minute'",
          [userId, purpose],
        )
      ).rowCount
    )
      return;
    const token = opaque(),
      id = uuid();
    await client.query(
      "UPDATE account_token SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL",
      [userId, purpose],
    );
    await client.query(
      "INSERT INTO account_token(id,user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+($5 * interval '1 minute'))",
      [id, userId, purpose, tokenHash(token), purpose === "RESET_PASSWORD" ? 30 : 1440],
    );
    const path = purpose === "RESET_PASSWORD" ? "reset-password" : "verify-email";
    await enqueueEmail(client, {
      dedupeKey: `account:${id}`,
      userId,
      recipient: user.email,
      kind: purpose,
      subject:
        purpose === "RESET_PASSWORD" ? "Reset your TapCart password" : "Verify your TapCart email",
      body: `${purpose === "RESET_PASSWORD" ? "Reset your password within 30 minutes." : "Verify your email within 24 hours."}\n${origin}/${path}#token=${token}\nIf you did not request this, ignore this email.`,
    });
  });
}
export const enqueueVerification = (db: Database, userId: string, origin: string) =>
  issueToken(db, userId, origin, "VERIFY_EMAIL");
export async function requestPasswordReset(db: Database, email: string, origin: string) {
  const user = (await db.query("SELECT id FROM app_user WHERE email=$1", [email])).rows[0];
  if (user) await issueToken(db, user.id, origin, "RESET_PASSWORD");
  // Response shape and minimum work do not expose account existence.
  await hashPassword(opaque());
}
export async function consumeAccountToken(db: Database, token: string, password?: string) {
  const purpose = password === undefined ? "VERIFY_EMAIL" : "RESET_PASSWORD";
  const passwordHash = password === undefined ? undefined : await hashPassword(password);
  const ok = await db.transaction(async (client) => {
    const row = (
      await client.query(
        "SELECT user_id FROM account_token WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now()",
        [tokenHash(token), purpose],
      )
    ).rows[0];
    if (!row) return false;
    await client.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [row.user_id]);
    // Lock/recheck permits simultaneous reset and token issuance without stale authority.
    const claimed = await client.query(
      "UPDATE account_token SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING id",
      [tokenHash(token)],
    );
    if (!claimed.rowCount) return false;
    if (passwordHash) {
      await client.query("UPDATE app_user SET password_hash=$2 WHERE id=$1", [
        row.user_id,
        passwordHash,
      ]);
      await client.query(
        "UPDATE account_mfa SET pending_ciphertext=NULL,pending_expires_at=NULL WHERE user_id=$1 AND enabled_at IS NULL",
        [row.user_id],
      );
      await client.query("UPDATE session SET expires_at=now() WHERE user_id=$1", [row.user_id]);
      await client.query(
        "UPDATE mfa_challenge SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [row.user_id],
      );
      await client.query(
        "UPDATE account_token SET used_at=now() WHERE user_id=$1 AND purpose='RESET_PASSWORD' AND used_at IS NULL",
        [row.user_id],
      );
    } else
      await client.query(
        "UPDATE app_user SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
        [row.user_id],
      );
    return true;
  });
  if (!ok) throw new ApiError(400, "This link has expired or has already been used.");
}
export async function beginMfaEnrollment(db: Database, userId: string, password: string) {
  return db.transaction(async (client) => {
    const user = (await client.query("SELECT * FROM app_user WHERE id=$1 FOR UPDATE", [userId]))
      .rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash)))
      throw new ApiError(401, "Password is incorrect.");
    if (
      (
        await client.query(
          "SELECT 1 FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL",
          [userId],
        )
      ).rowCount
    )
      throw new ApiError(409, "Two-factor authentication is already enabled.");
    const secret = generateSecret();
    await client.query(
      "INSERT INTO account_mfa(user_id,pending_ciphertext,pending_expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET pending_ciphertext=$2,pending_expires_at=now()+interval '10 minutes'",
      [userId, encryptSecret(secret)],
    );
    const otpauthUrl = generateURI({ issuer: "TapCart", label: user.email, secret });
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl), expiresIn: 600 };
  });
}
function verifiedStep(code: string, secret: string) {
  if (!/^\d{6}$/.test(code)) return null;
  const epoch = Math.floor(Date.now() / 1000);
  const result = verifySync({
    secret,
    token: code,
    epoch,
    epochTolerance: 30,
    period: 30,
    digits: 6,
    algorithm: "sha1",
  });
  return result.valid ? Math.floor(epoch / 30) + result.delta : null;
}
export async function confirmMfaEnrollment(db: Database, userId: string, code: string) {
  return db.transaction(async (client) => {
    await client.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [userId]);
    const row = (
      await client.query(
        "SELECT * FROM account_mfa WHERE user_id=$1 AND enabled_at IS NULL AND pending_expires_at>now() FOR UPDATE",
        [userId],
      )
    ).rows[0];
    const step = row?.pending_ciphertext
      ? verifiedStep(code, decryptSecret(row.pending_ciphertext))
      : null;
    if (step === null) throw new ApiError(400, "Authenticator code is incorrect or setup expired.");
    await client.query(
      "UPDATE account_mfa SET secret_ciphertext=pending_ciphertext,pending_ciphertext=NULL,pending_expires_at=NULL,enabled_at=now(),last_step=$2 WHERE user_id=$1",
      [userId, step],
    );
    await client.query("DELETE FROM mfa_recovery_code WHERE user_id=$1", [userId]);
    const codes = Array.from({ length: 10 }, () => randomBytes(10).toString("hex").toUpperCase());
    for (const code of codes)
      await client.query("INSERT INTO mfa_recovery_code(user_id,code_hash) VALUES($1,$2)", [
        userId,
        recoveryHash(code),
      ]);
    await client.query("UPDATE session SET expires_at=now() WHERE user_id=$1", [userId]);
    return { recoveryCodes: codes };
  });
}
export async function createMfaLoginChallenge(db: Database, userId: string) {
  return db.transaction(async (client) => {
    await client.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [userId]);
    const row = (
      await client.query("SELECT enabled_at FROM account_mfa WHERE user_id=$1 FOR UPDATE", [userId])
    ).rows[0];
    if (!row?.enabled_at) return null;
    const challengeToken = opaque();
    await client.query(
      "UPDATE mfa_challenge SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [userId],
    );
    await client.query(
      "INSERT INTO mfa_challenge(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
      [tokenHash(challengeToken), userId],
    );
    return { mfaRequired: true as const, challengeToken, expiresIn: 300 };
  });
}
async function verifySecondFactor(
  client: PoolClient,
  userId: string,
  code: string,
  row: Record<string, unknown>,
) {
  if (row.secret_ciphertext) {
    const step = verifiedStep(code, decryptSecret(String(row.secret_ciphertext)));
    if (step !== null && step > Number(row.last_step)) {
      await client.query("UPDATE account_mfa SET last_step=$2 WHERE user_id=$1", [userId, step]);
      return true;
    }
  }
  return Boolean(
    (
      await client.query(
        "UPDATE mfa_recovery_code SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash",
        [userId, recoveryHash(code)],
      )
    ).rowCount,
  );
}
export async function completeMfaLogin(
  db: Database,
  challengeToken: string,
  code: string,
  onVerified?: (client: PoolClient, userId: string) => Promise<void>,
) {
  const result = await db.transaction(async (client) => {
    // MFA row is the shared lock for challenge attempts, enrollment and code reuse.
    const candidate = (
      await client.query("SELECT user_id FROM mfa_challenge WHERE token_hash=$1", [
        tokenHash(challengeToken),
      ])
    ).rows[0];
    if (!candidate) return null;
    await client.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [candidate.user_id]);
    const row = (
      await client.query(
        "SELECT * FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL FOR UPDATE",
        [candidate.user_id],
      )
    ).rows[0];
    const challenge = (
      await client.query(
        "UPDATE mfa_challenge SET attempts=attempts+1 WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() AND attempts<5 RETURNING user_id",
        [tokenHash(challengeToken)],
      )
    ).rows[0];
    if (!row || !challenge) return null;
    if (!(await verifySecondFactor(client, challenge.user_id, code, row))) return null;
    await client.query("UPDATE mfa_challenge SET used_at=now() WHERE token_hash=$1", [
      tokenHash(challengeToken),
    ]);
    if (onVerified) await onVerified(client, challenge.user_id);
    return challenge.user_id as string;
  });
  if (!result)
    throw new ApiError(
      401,
      "Code is incorrect or the sign-in challenge expired. Sign in again after five attempts.",
    );
  return result;
}
export async function disableMfa(db: Database, userId: string, password: string, code: string) {
  const ok = await db.transaction(async (client) => {
    const user = (
      await client.query("SELECT password_hash FROM app_user WHERE id=$1 FOR UPDATE", [userId])
    ).rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) return false;
    const row = (
      await client.query(
        "SELECT * FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (!row || !(await verifySecondFactor(client, userId, code, row))) return false;
    await client.query("DELETE FROM account_mfa WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM mfa_recovery_code WHERE user_id=$1", [userId]);
    await client.query(
      "UPDATE mfa_challenge SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [userId],
    );
    await client.query("UPDATE session SET expires_at=now() WHERE user_id=$1", [userId]);
    return true;
  });
  if (!ok) throw new ApiError(401, "Password or authentication code is incorrect.");
}
