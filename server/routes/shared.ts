import type { Request, Response } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import { json } from "../db.js";
import { ApiError } from "../errors.js";
import { getOrder, type MutationResult } from "../protocol.js";
export const uuidValue = z.string().uuid(),
  version = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const text = z.string().trim().min(1).max(200);
export const productSchema = z.object({
  sku: text.max(80),
  name: text,
  description: z.string().max(3000).default(""),
  category: text.max(80).default("General"),
  priceCents: z.number().int().min(0).max(100_000_000),
  imageUrl: z
    .union([
      z.literal(""),
      z
        .string()
        .url()
        .regex(/^https:\/\//, "Image URLs must use HTTPS."),
    ])
    .default(""),
});
export const authSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
});
export const toResult = (res: Response, result: MutationResult) => {
  if (result.replay) res.set("Idempotency-Replayed", "true");
  res.status(result.status).json(result.body);
};
export const id = (req: Request, key = "id") => uuidValue.parse(req.params[key]);
export const productSelect = `SELECT p.*,count(u.id) FILTER(WHERE u.status='AVAILABLE')::int AS available,count(u.id) FILTER(WHERE u.status='RESERVED')::int AS reserved,count(u.id) FILTER(WHERE u.status='SOLD')::int AS sold FROM product p LEFT JOIN inventory_unit u ON u.product_id=p.id`;
export async function product(db: Database, productId: string) {
  const row = (await db.query(`${productSelect} WHERE p.id=$1 GROUP BY p.id`, [productId])).rows[0];
  if (!row) throw new ApiError(404, "Product not found.");
  return json(row);
}
export function storeScope(req: Request) {
  const user = req.auth!.user;
  return user.role === "STORE" ? user.storeId : null;
}
export async function authorizeOrder(
  db: Database,
  req: Request,
  orderId: string,
  staffOnly = false,
) {
  const order = await getOrder(db, orderId),
    user = req.auth!.user;
  if (staffOnly && user.role === "CUSTOMER")
    throw new ApiError(403, "A store team member must confirm this action.");
  if (
    user.role === "ADMIN" ||
    (user.role === "STORE" && user.storeId === order.storeId) ||
    (!staffOnly && user.role === "CUSTOMER" && user.id === order.userId)
  )
    return order;
  throw new ApiError(404, "Order not found.");
}
