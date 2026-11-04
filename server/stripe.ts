import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { z } from "zod";
import type { Database } from "./db.js";
import { ApiError } from "./errors.js";
import { recordPayment } from "./protocol.js";
import { applyStripeRefund } from "./refunds.js";
import { logger } from "./logger.js";

interface Attempt {
  order_id: string;
  attempt_id: string;
  idempotency_key: string;
  request_body: Stripe.Checkout.SessionCreateParams;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  provider_status: string;
  created_at: Date;
}

interface StripeDependencies {
  client?: Stripe;
  secretKey?: string;
  webhookSecret?: string;
}

function configuration(dependencies: StripeDependencies = {}) {
  const key = dependencies.secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!key || !/^sk_(test|live)_/.test(key))
    throw new ApiError(503, "Card payments are not configured.", "PAYMENTS_UNAVAILABLE");
  return {
    client: dependencies.client ?? new Stripe(key, { maxNetworkRetries: 2, timeout: 10000 }),
    live: key.startsWith("sk_live_"),
  };
}

const sessionSchema = z.object({
  id: z.string().startsWith("cs_"),
  object: z.literal("checkout.session"),
  mode: z.literal("payment"),
  currency: z.literal("inr"),
  amount_total: z.number().int().positive().safe(),
  client_reference_id: z.string().uuid(),
  metadata: z.object({
    orderId: z.string().uuid(),
    attemptId: z.string().uuid(),
    application: z.literal("tapcart"),
  }),
  livemode: z.boolean(),
  payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  status: z.enum(["open", "complete", "expired"]).nullable(),
  payment_intent: z
    .union([z.string().startsWith("pi_"), z.object({ id: z.string().startsWith("pi_") })])
    .nullable(),
  url: z.string().nullable().optional(),
});
type VerifiedSession = z.infer<typeof sessionSchema>;

function parseSession(value: unknown): VerifiedSession {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(
      400,
      "The payment session does not match the expected card payment format.",
      "PAYMENT_MISMATCH",
    );
  return parsed.data;
}

/** A real signed webhook or authenticated Stripe retrieval is required before calling this. */
async function applySession(
  db: Database,
  value: unknown,
  eventId: string,
  live: boolean,
  failed = false,
) {
  const session = parseSession(value);
  if (session.livemode !== live || session.client_reference_id !== session.metadata.orderId)
    throw new ApiError(400, "Payment account or order mismatch.", "PAYMENT_MISMATCH");
  if (!failed && session.payment_status !== "paid") return;
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!failed && (!paymentIntent || session.status !== "complete"))
    throw new ApiError(
      400,
      "Successful payment is missing its settled payment identity.",
      "PAYMENT_MISMATCH",
    );
  await db.transaction(async (client) => {
    // Lock order before provider attempt and inventory, matching protocol lock order.
    const order = (
      await client.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [
        session.metadata.orderId,
      ])
    ).rows[0];
    const attempt = (
      await client.query<Attempt>(
        "SELECT * FROM stripe_payment_attempt WHERE order_id=$1 FOR UPDATE",
        [session.metadata.orderId],
      )
    ).rows[0];
    if (
      !order ||
      !attempt ||
      order.payment_method !== "CARD" ||
      attempt.attempt_id !== session.metadata.attemptId ||
      order.total_cents !== session.amount_total ||
      (attempt.stripe_session_id && attempt.stripe_session_id !== session.id) ||
      (attempt.stripe_payment_intent_id &&
        paymentIntent &&
        attempt.stripe_payment_intent_id !== paymentIntent)
    )
      throw new ApiError(
        400,
        "Payment does not match its persisted order and attempt.",
        "PAYMENT_MISMATCH",
      );
    await client.query(
      "UPDATE stripe_payment_attempt SET stripe_session_id=$2,stripe_payment_intent_id=coalesce($3,stripe_payment_intent_id),provider_status=CASE WHEN provider_status='PAID' THEN 'PAID' ELSE $4 END,checked_at=now() WHERE order_id=$1",
      [
        order.id,
        session.id,
        paymentIntent ?? null,
        session.payment_status === "paid" ? "PAID" : "FAILED",
      ],
    );
    await recordPayment(client, order.id, eventId, failed ? "FAILED" : "SUCCEEDED", "STRIPE");
    if (!failed)
      await client.query("UPDATE customer_order SET payment_reference=$2 WHERE id=$1", [
        order.id,
        paymentIntent,
      ]);
  });
}

export async function createStripePayment(
  db: Database,
  orderId: string,
  origin: string,
  dependencies: StripeDependencies = {},
) {
  const { client, live } = configuration(dependencies);
  const base = new URL(origin);
  if (
    base.origin !== origin ||
    !["https:", "http:"].includes(base.protocol) ||
    (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  )
    throw new ApiError(500, "The application payment origin is invalid.");
  const attempt = await db.transaction(async (connection) => {
    const order = (
      await connection.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [orderId])
    ).rows[0];
    if (!order) throw new ApiError(404, "Order not found.");
    if (order.payment_method !== "CARD")
      throw new ApiError(409, "This order does not use card payment.");
    const existing = (
      await connection.query<Attempt>("SELECT * FROM stripe_payment_attempt WHERE order_id=$1", [
        orderId,
      ])
    ).rows[0];
    if (existing) return existing;
    if (order.status !== "PAYMENT_PENDING")
      throw new ApiError(409, "This order no longer accepts a new payment.");
    const units = (
      await connection.query<{ name: string; price_cents: number; protected: boolean }>(
        `SELECT i.name,i.price_cents,(u.status='RESERVED' AND u.checkout_order_id=i.order_id AND u.reservation_id=i.reservation_id AND u.version=i.protected_version AND u.checkout_protected_until>now()) AS protected FROM order_unit i JOIN inventory_unit u ON u.id=i.unit_id WHERE i.order_id=$1 ORDER BY i.unit_id`,
        [orderId],
      )
    ).rows;
    if (
      !units.length ||
      units.some((unit) => !unit.protected) ||
      units.reduce((sum, unit) => sum + unit.price_cents, 0) !== order.total_cents ||
      order.total_cents <= 0
    )
      throw new ApiError(409, "The order has no live protected inventory or valid payable total.");
    const attemptId = randomUUID();
    const metadata = { application: "tapcart", orderId, attemptId };
    const request: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      allowed_payment_method_types: ["card"],
      client_reference_id: orderId,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/customer?order=${orderId}`,
      cancel_url: `${origin}/customer?order=${orderId}`,
      expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
      line_items: units.map((unit) => ({
        quantity: 1,
        price_data: {
          currency: "inr",
          unit_amount: unit.price_cents,
          product_data: { name: unit.name },
        },
      })),
    };
    return (
      await connection.query<Attempt>(
        "INSERT INTO stripe_payment_attempt(order_id,attempt_id,idempotency_key,request_body) VALUES($1,$2,$3,$4::jsonb) RETURNING *",
        [orderId, attemptId, `tapcart:order:${orderId}:checkout:v1`, JSON.stringify(request)],
      )
    ).rows[0]!;
  });
  let session: Stripe.Checkout.Session;
  try {
    if (attempt.stripe_session_id)
      session = await client.checkout.sessions.retrieve(attempt.stripe_session_id);
    else {
      // Never risk a new object once the provider's 24-hour idempotency retention may lapse.
      if (Date.now() - new Date(attempt.created_at).getTime() >= 23 * 3600000)
        throw new ApiError(
          409,
          "The payment outcome requires provider reconciliation. No replacement charge will be created.",
          "PAYMENT_REVIEW",
        );
      session = await client.checkout.sessions.create(attempt.request_body, {
        idempotencyKey: attempt.idempotency_key,
      });
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      "The card provider did not confirm its response. Retry this same order; a new charge identifier will not be created.",
      "PAYMENT_PROVIDER_UNAVAILABLE",
    );
  }
  const verified = parseSession(session);
  if (
    verified.livemode !== live ||
    verified.metadata.attemptId !== attempt.attempt_id ||
    verified.metadata.orderId !== orderId ||
    verified.client_reference_id !== orderId
  )
    throw new ApiError(
      502,
      "The card provider returned an inconsistent payment identity.",
      "PAYMENT_MISMATCH",
    );
  await db.transaction(async (connection) => {
    await connection.query("SELECT id FROM customer_order WHERE id=$1 FOR UPDATE", [orderId]);
    const current = (
      await connection.query<Attempt>(
        "SELECT * FROM stripe_payment_attempt WHERE order_id=$1 FOR UPDATE",
        [orderId],
      )
    ).rows[0]!;
    const total = (
      await connection.query<{ total_cents: number }>(
        "SELECT total_cents FROM customer_order WHERE id=$1",
        [orderId],
      )
    ).rows[0]?.total_cents;
    if (verified.amount_total !== total)
      throw new ApiError(
        502,
        "The card provider returned an inconsistent payment amount.",
        "PAYMENT_MISMATCH",
      );
    if (current.stripe_session_id && current.stripe_session_id !== session.id)
      throw new ApiError(409, "A different payment is already bound to this order.");
    await connection.query(
      "UPDATE stripe_payment_attempt SET stripe_session_id=$2,checked_at=now() WHERE order_id=$1",
      [orderId, session.id],
    );
  });
  if (verified.payment_status === "paid")
    await applySession(db, session, `stripe:reconcile:${session.id}:paid`, live);
  else if (verified.status === "expired")
    await applySession(db, session, `stripe:reconcile:${session.id}:expired`, live, true);
  if (verified.status !== "open" || verified.payment_status !== "unpaid")
    return {
      sessionId: session.id,
      url: null,
      status: verified.payment_status === "paid" ? "PAID" : "EXPIRED",
    };
  const url = new URL(session.url ?? "");
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
    throw new ApiError(502, "The card provider returned an invalid hosted payment URL.");
  return { sessionId: session.id, url: url.href, status: "OPEN" };
}

export function createStripeWebhook(
  db: Database,
  dependencies: StripeDependencies = {},
): RequestHandler {
  return async (request, response, next) => {
    try {
      const { client, live } = configuration(dependencies);
      const secret = dependencies.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new ApiError(503, "The card webhook is not configured.");
      const signature = request.get("stripe-signature");
      if (!Buffer.isBuffer(request.body) || !signature)
        throw new ApiError(400, "A signed raw payment event is required.");
      let event: Stripe.Event;
      try {
        event = client.webhooks.constructEvent(request.body, signature, secret, 300);
      } catch {
        throw new ApiError(400, "The card event signature is invalid or expired.");
      }
      const now = Math.floor(Date.now() / 1000);
      if (
        event.livemode !== live ||
        !Number.isSafeInteger(event.created) ||
        event.created > now + 300 ||
        event.created < now - 31 * 86400 ||
        !event.id.startsWith("evt_")
      )
        throw new ApiError(400, "The card event account or creation time is invalid.");
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      )
        await applySession(db, event.data.object, event.id, live);
      else if (
        event.type === "checkout.session.expired" ||
        event.type === "checkout.session.async_payment_failed"
      )
        await applySession(db, event.data.object, event.id, live, true);
      else if (
        event.type === "refund.updated" ||
        event.type === "refund.created" ||
        event.type === "refund.failed"
      ) {
        const metadata = event.data.object.metadata;
        if (metadata?.application === "tapcart") await applyStripeRefund(db, event.data.object);
      }
      response.json({ received: true });
    } catch (error) {
      next(error);
    }
  };
}

/** Run from the worker outside database transactions. Uses retrieval only, never creates a charge. */
export async function reconcileStripePayments(db: Database, dependencies: StripeDependencies = {}) {
  if (!dependencies.client && !process.env.STRIPE_SECRET_KEY) return;
  const { client, live } = configuration(dependencies);
  const attempts = (
    await db.query<Attempt>(
      `SELECT a.* FROM stripe_payment_attempt a JOIN customer_order o ON o.id=a.order_id WHERE o.status IN ('PAYMENT_PENDING','PAYMENT_FAILED','PAID') AND (a.checked_at IS NULL OR a.checked_at<now()-interval '1 minute') AND (a.stripe_session_id IS NOT NULL OR a.created_at>now()-interval '23 hours') ORDER BY coalesce(a.checked_at,a.created_at) LIMIT 25`,
    )
  ).rows;
  for (const attempt of attempts) {
    try {
      if (!attempt.stripe_session_id) {
        const successUrl = attempt.request_body.success_url;
        if (!successUrl) throw new Error("Persisted Stripe attempt has no return origin");
        await createStripePayment(db, attempt.order_id, new URL(successUrl).origin, dependencies);
        continue;
      }
      const session = await client.checkout.sessions.retrieve(attempt.stripe_session_id!);
      if (session.payment_status === "paid")
        await applySession(db, session, `stripe:reconcile:${session.id}:paid`, live);
      else if (session.status === "expired")
        await applySession(db, session, `stripe:reconcile:${session.id}:expired`, live, true);
      else
        await db.query("UPDATE stripe_payment_attempt SET checked_at=now() WHERE order_id=$1", [
          attempt.order_id,
        ]);
    } catch (error) {
      // One unavailable provider attempt must not starve unrelated orders. Do not log secrets/provider bodies.
      await db.query("UPDATE stripe_payment_attempt SET checked_at=now() WHERE order_id=$1", [
        attempt.order_id,
      ]);
      logger.warn(
        {
          orderId: attempt.order_id,
          code: error instanceof ApiError ? error.code : "PROVIDER_UNAVAILABLE",
        },
        "Stripe reconciliation needs retry",
      );
    }
  }
}
