import type { PoolClient } from "pg";
import type { Auth } from "../types.js";
import { ApiError } from "../errors.js";

export interface PricingUnit {
  id: string;
  store_id: string;
  product_id: string;
  price_cents: number;
}
export interface Pricing {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponId: string | null;
  couponCode: string | null;
  items: { unitId: string; listPriceCents: number; discountCents: number; priceCents: number }[];
}
export function allocateDiscount(prices: number[], discount: number): number[] {
  const total = prices.reduce((sum, price) => sum + price, 0);
  if (
    !prices.every((p) => Number.isSafeInteger(p) && p >= 0) ||
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(discount) ||
    discount < 0 ||
    discount > total
  )
    throw new ApiError(400, "Invalid pricing amounts.");
  if (!total) return prices.map(() => 0);
  // BigInt avoids rounding errors in price * discount. Stable largest-remainder allocation.
  const parts = prices.map((price, index) => ({
    index,
    value: Number((BigInt(price) * BigInt(discount)) / BigInt(total)),
    remainder: (BigInt(price) * BigInt(discount)) % BigInt(total),
  }));
  let remaining = discount - parts.reduce((sum, part) => sum + part.value, 0);
  for (const part of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (remaining > 0 && part.value < prices[part.index]) {
      part.value++;
      remaining--;
    }
  }
  return parts.map((part) => part.value);
}
/** Called inside the checkout transaction; coupon lock remains held until claimPricing commits. */
export async function preparePricing(
  client: PoolClient,
  auth: Auth,
  rows: PricingUnit[],
  couponCode?: string,
): Promise<Pricing> {
  rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  if (
    !rows.length ||
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    new Set(rows.map((r) => r.store_id)).size !== 1
  )
    throw new ApiError(400, "Price one store's distinct physical units at a time.");
  const subtotalCents = rows.reduce((sum, r) => sum + r.price_cents, 0);
  if (
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents > 2_147_483_647 ||
    rows.some((r) => !Number.isSafeInteger(r.price_cents) || r.price_cents < 0)
  )
    throw new ApiError(400, "The order total exceeds the supported checkout limit.");
  let discountCents = 0,
    couponId: string | null = null,
    code: string | null = null;
  if (couponCode?.trim()) {
    const coupon = (
      await client.query(
        "SELECT *, (starts_at IS NULL OR starts_at<=now()) AND (expires_at IS NULL OR expires_at>now()) AS in_window FROM coupon WHERE store_id=$1 AND code=$2 FOR UPDATE",
        [rows[0].store_id, couponCode.trim().toUpperCase()],
      )
    ).rows[0];
    if (
      !coupon ||
      !coupon.active ||
      !coupon.in_window ||
      (coupon.max_uses !== null && coupon.uses >= coupon.max_uses)
    )
      throw new ApiError(409, "This coupon is unavailable.", "COUPON_UNAVAILABLE");
    if (subtotalCents < coupon.minimum_spend_cents)
      throw new ApiError(400, "The order does not meet this coupon's minimum spend.");
    if (coupon.per_customer_limit !== null) {
      const used = (
        await client.query(
          "SELECT count(*)::int AS count FROM coupon_redemption WHERE coupon_id=$1 AND user_id=$2",
          [coupon.id, auth.user.id],
        )
      ).rows[0].count;
      if (used >= coupon.per_customer_limit)
        throw new ApiError(409, "You have reached this coupon's usage limit.", "COUPON_LIMIT");
    }
    couponId = coupon.id;
    code = coupon.code;
    discountCents =
      coupon.type === "PERCENT"
        ? Math.floor((subtotalCents * coupon.value) / 100)
        : Math.min(subtotalCents, coupon.value);
  }
  const allocations = allocateDiscount(
    rows.map((r) => r.price_cents),
    discountCents,
  );
  return {
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    couponId,
    couponCode: code,
    items: rows.map((r, i) => ({
      unitId: r.id,
      listPriceCents: r.price_cents,
      discountCents: allocations[i],
      priceCents: r.price_cents - allocations[i],
    })),
  };
}
export async function claimPricing(
  client: PoolClient,
  auth: Auth,
  orderId: string,
  pricing: Pricing,
) {
  if (!pricing.couponId) return;
  const inserted = await client.query(
    "INSERT INTO coupon_redemption(order_id,coupon_id,user_id,discount_cents) VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING RETURNING order_id",
    [orderId, pricing.couponId, auth.user.id, pricing.discountCents],
  );
  if (inserted.rowCount)
    await client.query("UPDATE coupon SET uses=uses+1 WHERE id=$1", [pricing.couponId]);
}
