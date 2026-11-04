import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";
import { ApiError } from "./errors.js";
import { event } from "./protocol.js";

interface RefundAttempt {
  id: string;
  order_id: string;
  amount_cents: number;
  payment_intent_id: string;
  idempotency_key: string;
  provider_refund_id: string | null;
  status: string;
  created_at: Date;
}
interface RefundDependencies {
  client?: Stripe;
  secretKey?: string;
}
function provider(dependencies: RefundDependencies) {
  const key = dependencies.secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!key || !/^sk_(test|live)_/.test(key))
    throw new ApiError(503, "Card refunds are not configured.");
  return dependencies.client ?? new Stripe(key, { timeout: 10000, maxNetworkRetries: 2 });
}
const refundSchema = z.object({
  id: z.string().startsWith("re_"),
  object: z.literal("refund"),
  amount: z.number().int().positive(),
  currency: z.literal("inr"),
  payment_intent: z.union([
    z.string().startsWith("pi_"),
    z.object({ id: z.string().startsWith("pi_") }),
  ]),
  status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]),
  metadata: z.object({
    application: z.literal("tapcart"),
    orderId: z.string().uuid(),
    refundAttemptId: z.string().uuid(),
  }),
});

// Accept only authenticated provider retrievals or signature-verified webhook objects.
export async function applyStripeRefund(db: Database, value: unknown) {
  const refund = refundSchema.parse(value);
  const paymentIntent =
    typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent.id;
  return db.transaction(async (client) => {
    const order = (
      await client.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [
        refund.metadata.orderId,
      ])
    ).rows[0];
    const attempt = (
      await client.query<RefundAttempt>(
        "SELECT * FROM stripe_refund_attempt WHERE id=$1 FOR UPDATE",
        [refund.metadata.refundAttemptId],
      )
    ).rows[0];
    if (
      !order ||
      !attempt ||
      attempt.order_id !== order.id ||
      order.payment_method !== "CARD" ||
      attempt.amount_cents !== refund.amount ||
      attempt.payment_intent_id !== paymentIntent ||
      (attempt.provider_refund_id && attempt.provider_refund_id !== refund.id)
    )
      throw new ApiError(400, "The refund does not match its persisted payment obligation.");
    if (attempt.status === "SUCCEEDED") return { status: "SUCCEEDED", providerRefundId: refund.id };
    const status =
      refund.status === "succeeded"
        ? "SUCCEEDED"
        : ["failed", "canceled"].includes(refund.status)
          ? "FAILED"
          : "PENDING";
    if (status === "SUCCEEDED") {
      if (
        order.refund_due_cents < refund.amount ||
        order.refunded_cents + refund.amount > order.total_cents
      )
        throw new ApiError(409, "The refund amount requires reconciliation.");
      const inserted = await client.query(
        "INSERT INTO order_refund(id,order_id,amount_cents,source) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id",
        [attempt.id, order.id, refund.amount, `STRIPE:${refund.id}`],
      );
      if (inserted.rowCount) {
        await client.query(
          "UPDATE customer_order SET refunded_cents=refunded_cents+$2,refund_due_cents=refund_due_cents-$2,status=CASE WHEN refund_due_cents-$2>0 THEN 'REFUND_PENDING' WHEN refunded_cents+$2>=total_cents THEN 'REFUNDED' ELSE 'COMPLETED' END WHERE id=$1",
          [order.id, refund.amount],
        );
        await event(client, "RefundConfirmed", order.id, {
          amountCents: refund.amount,
          providerRefundId: refund.id,
        });
      }
    }
    await client.query(
      "UPDATE stripe_refund_attempt SET provider_refund_id=$2,status=$3,checked_at=now() WHERE id=$1",
      [attempt.id, refund.id, status],
    );
    return { status, providerRefundId: refund.id };
  });
}

export async function createStripeRefund(
  db: Database,
  orderId: string,
  dependencies: RefundDependencies = {},
) {
  const stripe = provider(dependencies);
  const attempt = await db.transaction(async (client) => {
    const order = (
      await client.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [orderId])
    ).rows[0];
    if (!order || order.payment_method !== "CARD") throw new ApiError(404, "Card order not found.");
    const pending = (
      await client.query<RefundAttempt>(
        "SELECT * FROM stripe_refund_attempt WHERE order_id=$1 AND status IN ('CREATING','PENDING','FAILED') ORDER BY created_at DESC LIMIT 1",
        [orderId],
      )
    ).rows[0];
    if (pending) return pending;
    if (order.status !== "REFUND_PENDING" || order.refund_due_cents <= 0) {
      const previous = (
        await client.query<RefundAttempt>(
          "SELECT * FROM stripe_refund_attempt WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1",
          [orderId],
        )
      ).rows[0];
      if (previous) return previous;
      throw new ApiError(409, "No card refund is due.");
    }
    const payment = (
      await client.query<{ stripe_payment_intent_id: string | null }>(
        "SELECT stripe_payment_intent_id FROM stripe_payment_attempt WHERE order_id=$1",
        [orderId],
      )
    ).rows[0];
    if (!payment?.stripe_payment_intent_id)
      throw new ApiError(409, "The payment identity needs provider reconciliation before refund.");
    const id = randomUUID();
    return (
      await client.query<RefundAttempt>(
        "INSERT INTO stripe_refund_attempt(id,order_id,amount_cents,base_refunded_cents,payment_intent_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          id,
          orderId,
          order.refund_due_cents,
          order.refunded_cents,
          payment.stripe_payment_intent_id,
          `tapcart:refund:${orderId}:${order.refunded_cents}`,
        ],
      )
    ).rows[0]!;
  });
  if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED")
    return { status: attempt.status, providerRefundId: attempt.provider_refund_id };
  try {
    if (
      !attempt.provider_refund_id &&
      Date.now() - new Date(attempt.created_at).getTime() >= 23 * 3600000
    )
      throw new ApiError(
        409,
        "Unknown refund outcome needs provider reconciliation. No second refund will be created.",
      );
    const refund = attempt.provider_refund_id
      ? await stripe.refunds.retrieve(attempt.provider_refund_id)
      : await stripe.refunds.create(
          {
            payment_intent: attempt.payment_intent_id,
            amount: attempt.amount_cents,
            metadata: { application: "tapcart", orderId, refundAttemptId: attempt.id },
          },
          { idempotencyKey: attempt.idempotency_key },
        );
    return await applyStripeRefund(db, refund);
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) throw error;
    throw new ApiError(
      502,
      "Refund outcome is unknown. Retry the same order; its stable refund identifier is preserved.",
    );
  }
}

export async function reconcileStripeRefunds(db: Database) {
  if (!process.env.STRIPE_SECRET_KEY) return;
  const rows = (
    await db.query<{ order_id: string }>(
      "SELECT order_id FROM stripe_refund_attempt WHERE status IN ('CREATING','PENDING') AND (checked_at IS NULL OR checked_at<now()-interval '1 minute') ORDER BY created_at LIMIT 25",
    )
  ).rows;
  for (const row of rows) {
    try {
      await createStripeRefund(db, row.order_id);
    } catch {
      await db.query(
        "UPDATE stripe_refund_attempt SET checked_at=now() WHERE order_id=$1 AND status IN ('CREATING','PENDING')",
        [row.order_id],
      );
    }
  }
}
