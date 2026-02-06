import { neon } from "@neondatabase/serverless"
import crypto from "node:crypto"

export interface Store {
  id: number
  store_id: string
  email: string
  status: "pending" | "approved" | "denied"
  created_at: string
  approved_at?: string
}

export interface Product {
  id: number
  store_id: string
  name: string
  stock: number
  price: number
}

export interface Customer {
  id: number
  store_id: string
  name: string
  phone: string
}

export interface Purchase {
  id: number
  store_id: string
  customer_id: number
  customer_name: string
  product_name: string
  quantity: number
  total_amount: number
  purchase_date: string
}

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return neon(url)
}

// --------------------------
// Password hashing / verify
// --------------------------
//
// Stored format:
// - scrypt$<saltB64url>$<hashB64url>
//
// Legacy formats we still accept for migration:
// - sha:<base64(password)>  (INSECURE legacy)
// - <numeric string>        (INSECURE legacy "simpleHash")
//
// On successful verification, legacy hashes are transparently upgraded.

const SCRYPT_PREFIX = "scrypt$"

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

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function requirePasswordPepper(): string {
  // Optional but recommended; allows invalidating hashes if leaked.
  return process.env.PASSWORD_PEPPER || ""
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const pepper = requirePasswordPepper()
  const material = pepper ? `${password}\u0000${pepper}` : password
  const key = crypto.scryptSync(material, salt, 32)
  return `${SCRYPT_PREFIX}${base64UrlEncode(salt)}$${base64UrlEncode(key)}`
}

type VerifyPasswordResult = { ok: boolean; needsUpgrade: boolean }

export function verifyPassword(storedHash: string, password: string): VerifyPasswordResult {
  // New format
  if (storedHash.startsWith(SCRYPT_PREFIX)) {
    const parts = storedHash.split("$")
    // ["scrypt", "<salt>", "<hash>"]
    const saltB64 = parts[1]
    const hashB64 = parts[2]
    if (!saltB64 || !hashB64) return { ok: false, needsUpgrade: false }
    const salt = base64UrlDecodeToBuffer(saltB64)
    const expected = base64UrlDecodeToBuffer(hashB64)
    const pepper = requirePasswordPepper()
    const material = pepper ? `${password}\u0000${pepper}` : password
    const actual = crypto.scryptSync(material, salt, expected.length)
    return { ok: timingSafeEqual(actual, expected), needsUpgrade: false }
  }

  // Legacy store accounts: sha:<base64(password)>
  if (storedHash.startsWith("sha:")) {
    const legacy = `sha:${Buffer.from(password).toString("base64")}`
    return { ok: legacy === storedHash, needsUpgrade: true }
  }

  // Legacy admin accounts: numeric string produced by simpleHash()
  if (/^-?\d+$/.test(storedHash)) {
    const legacy = simpleHash(password)
    return { ok: legacy === storedHash, needsUpgrade: true }
  }

  return { ok: false, needsUpgrade: false }
}

// Stores
export async function createPendingStore(storeId: string, email: string, passwordHash: string): Promise<void> {
  const sql = getSql()
  
  // Ensure stores table exists
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        store_id VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP NULL,
        approved_by VARCHAR(255) NULL
      )
    `
  } catch (tableError) {
    // Table might already exist, continue
    console.log("Table creation check:", tableError)
  }
  
  await sql`insert into stores (store_id, email, password_hash, status)
            values (${storeId}, ${email}, ${passwordHash}, 'pending')
            on conflict (store_id) do nothing`
}

export async function listStores(): Promise<Store[]> {
  const sql = getSql()
  const rows = await sql`select id, store_id, email, status, created_at, approved_at from stores order by created_at desc`
  return rows as unknown as Store[]
}

export async function getAllStores(): Promise<Store[]> {
  return listStores()
}

export async function approveOrDenyStore(storeId: string, action: "approve" | "deny"): Promise<void> {
  const sql = getSql()
  if (action === "approve") {
    await sql`update stores set status = 'approved', approved_at = now() where store_id = ${storeId}`
  } else {
    await sql`update stores set status = 'denied' where store_id = ${storeId}`
  }
}

// Authentication helpers (demo)
export async function getStoreByStoreId(storeId: string): Promise<Store | null> {
  const sql = getSql()
  const rows = await sql`select id, store_id, email, status, created_at, approved_at from stores where store_id = ${storeId} limit 1`
  return (rows as any[])[0] || null
}

export interface VerifyStoreResult {
  isValid: boolean
  reason?: "not_found" | "not_approved" | "wrong_password"
}

export async function verifyStoreCredentials(
  storeId: string,
  password: string
): Promise<VerifyStoreResult> {
  try {
    const sql = getSql()
    
    // Trim inputs to avoid whitespace issues
    const trimmedStoreId = storeId.trim()
    const trimmedPassword = password.trim()
    
    // Get the store with password hash
    const result = await sql`
      select password_hash, status from stores where store_id = ${trimmedStoreId} limit 1
    `
    
    if (!result || result.length === 0) {
      return { isValid: false, reason: "not_found" }
    }
    
    const store = result[0] as { password_hash: string; status: string }
    
    // Check if store is approved
    if (store.status !== "approved") {
      return { isValid: false, reason: "not_approved" }
    }
    
    const verify = verifyPassword(store.password_hash, trimmedPassword)
    
    if (!verify.ok) {
      return { isValid: false, reason: "wrong_password" }
    }

    // Transparent upgrade from legacy hashes
    if (verify.needsUpgrade) {
      const upgraded = hashPassword(trimmedPassword)
      await sql`update stores set password_hash = ${upgraded} where store_id = ${trimmedStoreId}`
    }
    
    return { isValid: true }
  } catch (error) {
    console.error("Error verifying store credentials:", error)
    return { isValid: false, reason: "wrong_password" }
  }
}

// Products
export async function getProductsByStoreId(storeId: string): Promise<Product[]> {
  const sql = getSql()
  const rows = await sql`
    select id,
           store_id,
           name,
           (stock::int)   as stock,
           (price::float) as price
    from products
    where store_id = ${storeId}
    order by id asc
  `
  return rows as unknown as Product[]
}

// Customers
export async function getCustomersByStoreId(storeId: string): Promise<Customer[]> {
  const sql = getSql()
  const rows = await sql`select id, store_id, name, phone from customers where store_id = ${storeId} order by id asc`
  return rows as unknown as Customer[]
}

// Purchases
export async function getPurchasesByStoreId(storeId: string): Promise<Purchase[]> {
  const sql = getSql()
  const rows = await sql`
    select p.id,
           p.store_id,
           p.customer_id,
           c.name as customer_name,
           pr.name as product_name,
           p.quantity,
           p.total_amount,
           p.purchase_date
    from purchases p
    left join customers c on c.id = p.customer_id
    left join products pr on pr.id = p.product_id
    where p.store_id = ${storeId}
    order by p.purchase_date desc, p.id desc`
  return rows as unknown as Purchase[]
}

// Simple password hash function (for demo purposes)
function simpleHash(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash.toString()
}

export async function verifyAdminCredentials(email: string, password: string): Promise<boolean> {
  const sql = getSql()
  
  try {
    // Get the admin user's password hash
    const result = await sql`
      select password_hash from admin_users where email = ${email} limit 1
    `
    
    if (!result || result.length === 0) {
      return false
    }
    
    const user = result[0] as { password_hash: string }
    
    const verify = verifyPassword(user.password_hash, password)
    if (!verify.ok) return false

    if (verify.needsUpgrade) {
      const upgraded = hashPassword(password)
      await sql`update admin_users set password_hash = ${upgraded} where email = ${email}`
    }

    return true
    
  } catch (error) {
    console.error('Error verifying admin credentials:', error)
    return false
  }
}
