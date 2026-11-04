import type {} from "./express.js";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { v7 as uuid } from "uuid";
import type { Database } from "./db.js";
import type { Role, User } from "./types.js";
import { ApiError } from "./errors.js";

const derive = promisify(scrypt);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [scheme, salt, expected] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = (await derive(password, salt, 64)) as Buffer;
  const stored = Buffer.from(expected, "hex");
  return stored.length === derived.length && timingSafeEqual(derived, stored);
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const sessionCookie = "tapcart_session";
export const cookieOptions = (production: boolean) => ({
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 7 * 24 * 3600 * 1000,
});
export async function createSession(
  db: Database,
  userId: string,
  res: Response,
  production: boolean,
) {
  const token = randomBytes(32).toString("base64url"),
    csrfToken = randomBytes(32).toString("base64url"),
    id = uuid();
  await db.query(
    "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",
    [id, userId, tokenHash(token), csrfToken],
  );
  res.cookie(sessionCookie, token, cookieOptions(production));
  return csrfToken;
}
export function loadAuth(db: Database) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[sessionCookie];
    if (token && typeof token === "string" && token.length < 200) {
      const row = (
        await db.query(
          `SELECT s.id AS session_id,s.csrf_token,u.id,u.name,u.email,u.role,st.id AS store_id,st.status AS store_status,CASE WHEN st.owner_id=u.id THEN 'OWNER' ELSE m.role END AS store_role
    FROM session s JOIN app_user u ON u.id=s.user_id LEFT JOIN store_member m ON m.user_id=u.id LEFT JOIN store st ON st.owner_id=u.id OR st.id=m.store_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
          [tokenHash(token)],
        )
      ).rows[0];
      if (row)
        req.auth = {
          user: {
            id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            storeId: row.store_id,
            storeRole: row.store_role,
          },
          sessionId: row.session_id,
          csrfToken: row.csrf_token,
        };
    }
    next();
  };
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw new ApiError(401, "Sign in to continue.", "AUTH_REQUIRED");
  next();
}
export function roles(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw new ApiError(401, "Sign in to continue.");
    if (!allowed.includes(req.auth.user.role))
      throw new ApiError(403, "You do not have permission for this action.");
    next();
  };
}
export async function requireStore(db: Database, user: User, requested?: string): Promise<string> {
  if (user.role === "STORE" && requested && requested !== user.storeId)
    throw new ApiError(404, "Store resource not found.");
  const id = user.role === "ADMIN" ? requested : user.storeId;
  if (!id) throw new ApiError(403, "A store account is required.");
  const store = (await db.query("SELECT status FROM store WHERE id=$1", [id])).rows[0];
  if (!store) throw new ApiError(404, "Store not found.");
  if (store.status !== "APPROVED")
    throw new ApiError(403, "Your store must be approved before managing inventory.");
  return id;
}
export function csrfProtection(origin: string, production: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    let csrfToken = req.auth?.csrfToken || req.cookies?.tapcart_csrf;
    if (typeof csrfToken !== "string" || csrfToken.length !== 43) {
      csrfToken = randomBytes(32).toString("base64url");
      res.cookie("tapcart_csrf", csrfToken, { ...cookieOptions(production), httpOnly: true });
    }
    req.csrfToken = csrfToken;
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }
    if (req.get("origin") !== origin || req.get("x-csrf-token") !== csrfToken)
      throw new ApiError(
        403,
        "The security token expired. Refresh the page and try again.",
        "CSRF_FAILED",
      );
    next();
  };
}
