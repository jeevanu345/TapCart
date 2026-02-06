// Authentication utilities and session management
//
// IMPORTANT: We intentionally do NOT store raw JSON sessions in cookies.
// Cookies must be treated as attacker-controlled input; sessions are signed.
import { cookies } from "next/headers"
import crypto from "node:crypto"

type SessionKind = "store" | "admin"

type BaseSessionClaims = {
  v: 1
  typ: SessionKind
  sub: string
  iat: number
  exp: number
}

type SignedTokenClaims = {
  v: 1
  typ: string
  sub: string
  iat: number
  exp: number
}

export interface StoreSession {
  storeId: string
  isAuthenticated: true
}

export interface AdminSession {
  email: string
  isAuthenticated: true
}

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error("SESSION_SECRET is not set")
  }
  return secret
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + pad, "base64")
}

function signToken(payloadJson: string, secret: string): string {
  const mac = crypto.createHmac("sha256", secret).update(payloadJson).digest()
  return base64UrlEncode(mac)
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

function mintSessionToken(kind: SessionKind, subject: string, maxAgeSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const claims: BaseSessionClaims = {
    v: 1,
    typ: kind,
    sub: subject,
    iat: now,
    exp: now + maxAgeSeconds,
  }
  const payloadJson = JSON.stringify(claims)
  const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf8"))
  const sig = signToken(payloadB64, requireSessionSecret())
  return `${payloadB64}.${sig}`
}

function mintSignedToken(typ: string, subject: string, maxAgeSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const claims: SignedTokenClaims = {
    v: 1,
    typ,
    sub: subject,
    iat: now,
    exp: now + maxAgeSeconds,
  }
  const payloadJson = JSON.stringify(claims)
  const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf8"))
  const sig = signToken(payloadB64, requireSessionSecret())
  return `${payloadB64}.${sig}`
}

function verifySignedToken(token: string, expectedTyp: string): SignedTokenClaims | null {
  const [payloadB64, sig] = token.split(".")
  if (!payloadB64 || !sig) return null

  const expectedSig = signToken(payloadB64, requireSessionSecret())
  if (!timingSafeEqual(sig, expectedSig)) return null

  let claims: SignedTokenClaims
  try {
    claims = JSON.parse(base64UrlDecodeToBuffer(payloadB64).toString("utf8")) as SignedTokenClaims
  } catch {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (claims?.v !== 1) return null
  if (claims.typ !== expectedTyp) return null
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null
  if (typeof claims.exp !== "number" || claims.exp <= now) return null
  return claims
}

function verifySessionToken(token: string, expectedKind: SessionKind): BaseSessionClaims | null {
  const [payloadB64, sig] = token.split(".")
  if (!payloadB64 || !sig) return null

  const expectedSig = signToken(payloadB64, requireSessionSecret())
  if (!timingSafeEqual(sig, expectedSig)) return null

  let claims: BaseSessionClaims
  try {
    claims = JSON.parse(base64UrlDecodeToBuffer(payloadB64).toString("utf8")) as BaseSessionClaims
  } catch {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (claims?.v !== 1) return null
  if (claims.typ !== expectedKind) return null
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null
  if (typeof claims.exp !== "number" || claims.exp <= now) return null
  return claims
}

const STORE_COOKIE = "store-session"
const ADMIN_COOKIE = "admin-session"
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

export async function getStoreSession(): Promise<StoreSession | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(STORE_COOKIE)
  if (!sessionCookie?.value) return null

  const claims = verifySessionToken(sessionCookie.value, "store")
  if (!claims) return null

  return { storeId: claims.sub, isAuthenticated: true }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(ADMIN_COOKIE)
  if (!sessionCookie?.value) return null

  const claims = verifySessionToken(sessionCookie.value, "admin")
  if (!claims) return null

  return { email: claims.sub, isAuthenticated: true }
}

export function setStoreSession(storeId: string) {
  const token = mintSessionToken("store", storeId, SESSION_MAX_AGE_SECONDS)
  return {
    name: STORE_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

export function setAdminSession(email: string) {
  const token = mintSessionToken("admin", email, SESSION_MAX_AGE_SECONDS)
  return {
    name: ADMIN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

export function clearSession(type: SessionKind) {
  const cookieName = type === "store" ? STORE_COOKIE : ADMIN_COOKIE
  return {
    name: cookieName,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
  }
}

// --------------------------
// Signed links (e.g. bills)
// --------------------------
const BILL_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export function mintBillToken(orderId: string): string {
  return mintSignedToken("bill", orderId, BILL_TOKEN_TTL_SECONDS)
}

export function verifyBillToken(token: string, orderId: string): boolean {
  const claims = verifySignedToken(token, "bill")
  return !!claims && claims.sub === orderId
}
