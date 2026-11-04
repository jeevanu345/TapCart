import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { createDatabase, migrate } from "./db.js";
import { createStripePayment, createStripeWebhook } from "./stripe.js";
import { checkout, expireReservations, returnUnit } from "./protocol.js";
import { ApiError } from "./errors.js";
import type { Auth } from "./types.js";
import { createStripeRefund, applyStripeRefund } from "./refunds.js";

const key = "sk_test_local_unit_tests";
const secret = "whsec_local_unit_tests";
function webhookApp(db: Database, client = new Stripe(key)) {
  const app = express();
  app.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    createStripeWebhook(db, { client, secretKey: key, webhookSecret: secret }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res
        .status(error instanceof ApiError ? error.status : 500)
        .json({ error: error instanceof Error ? error.message : "Failed" }),
  );
  return app;
}
function signedPayload(client: Stripe, payload: unknown, timestamp?: number) {
  const body = JSON.stringify(payload);
  return {
    body,
    signature: client.webhooks.generateTestHeaderString({ payload: body, secret, timestamp }),
  };
}
const event = (type: string, object: unknown) => ({
  id: `evt_${randomUUID()}`,
  object: "event",
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  type,
  data: { object },
});

describe("Stripe raw webhook authentication", () => {
  const client = new Stripe(key);
  const db = { transaction: vi.fn(), query: vi.fn() } as unknown as Database;
  afterEach(() => vi.clearAllMocks());
  it("verifies a genuine SDK signature before accepting an unrelated event without DB writes", async () => {
    const signed = signedPayload(client, event("customer.created", { id: "cus_test" }));
    const result = await request(webhookApp(db, client))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signed.signature)
      .send(signed.body);
    expect(result.status).toBe(200);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("rejects tampering and expired signatures before any database access", async () => {
    const payload = event("customer.created", { id: "cus_test" });
    const fresh = signedPayload(client, payload);
    const old = signedPayload(client, payload, Math.floor(Date.now() / 1000) - 600);
    for (const signed of [{ ...fresh, body: fresh.body + " " }, old]) {
      const result = await request(webhookApp(db, client))
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", signed.signature)
        .send(signed.body);
      expect(result.status).toBe(400);
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("rejects wrong live mode and future event timestamps even with valid signatures", async () => {
    for (const payload of [
      { ...event("customer.created", {}), livemode: true },
      { ...event("customer.created", {}), created: Math.floor(Date.now() / 1000) + 900 },
    ]) {
      const signed = signedPayload(client, payload);
      const result = await request(webhookApp(db, client))
        .post("/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", signed.signature)
        .send(signed.body);
      expect(result.status).toBe(400);
    }
  });
  it("fails closed when provider credentials are absent", async () => {
    await expect(
      createStripePayment(db, randomUUID(), "http://localhost:5173", { secretKey: "" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("Stripe identity and durable retries with PostgreSQL", () => {
  let db: Database;
  const client = new Stripe(key);
  beforeAll(async () => {
    db = createDatabase(process.env.TEST_DATABASE_URL!);
    await migrate(db);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (db) await db.pool.end();
  });
  async function fixture() {
    const user = randomUUID(),
      store = randomUUID(),
      session = randomUUID(),
      product = randomUUID(),
      unit = randomUUID(),
      reservation = randomUUID();
    await db.transaction(async (connection) => {
      await connection.query(
        "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,'Stripe Test',$2,'unused','CUSTOMER')",
        [user, `${user}@test.local`],
      );
      await connection.query(
        "INSERT INTO store(id,owner_id,name,status) VALUES($1,$2,'Stripe Test Store','APPROVED')",
        [store, user],
      );
      await connection.query(
        "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,'unused',now()+interval '1 day')",
        [session, user, randomUUID()],
      );
      await connection.query(
        "INSERT INTO product(id,store_id,sku,name,price_cents) VALUES($1,$2,$3,'Test product',39900)",
        [product, store, randomUUID()],
      );
      await connection.query(
        "INSERT INTO inventory_unit(id,product_id,store_id,staff_code,status,reservation_id,owner_session_id,reserved_until,version) VALUES($1,$2,$3,$4,'RESERVED',$5,$6,now()+interval '15 minutes',1)",
        [unit, product, store, randomUUID(), reservation, session],
      );
    });
    const auth: Auth = {
      user: {
        id: user,
        name: "Test",
        email: `${user}@test.local`,
        role: "CUSTOMER",
        storeId: null,
      },
      sessionId: session,
      csrfToken: "unused",
    };
    const result = await db.transaction((connection) =>
      checkout(connection, auth, {
        items: [{ unitId: unit, reservationId: reservation, version: 1 }],
        method: "CARD",
      }),
    );
    return { orderId: (result.body as { id: string }).id, unit };
  }
  function mockSession(params: Stripe.Checkout.SessionCreateParams, paid = false) {
    return {
      id: `cs_test_${randomUUID()}`,
      object: "checkout.session",
      mode: "payment",
      amount_total: 39900,
      currency: "inr",
      client_reference_id: params.client_reference_id,
      metadata: params.metadata,
      livemode: false,
      payment_status: paid ? "paid" : "unpaid",
      status: paid ? "complete" : "open",
      payment_intent: paid ? `pi_${randomUUID()}` : null,
      url: "https://checkout.stripe.com/c/pay/test",
    } as Stripe.Checkout.Session;
  }
  it("retries a lost create response with the exact persisted request and provider key", async () => {
    const { orderId } = await fixture();
    let stored: Stripe.Checkout.Session | undefined;
    const create = vi
      .spyOn(client.checkout.sessions, "create")
      .mockImplementation(async (params) => {
        if (!stored) {
          stored = mockSession(params!);
          throw new Error("Lost response");
        }
        return stored as Stripe.Response<Stripe.Checkout.Session>;
      });
    await expect(
      createStripePayment(db, orderId, "http://localhost:5173", { client, secretKey: key }),
    ).rejects.toMatchObject({ status: 502 });
    const result = await createStripePayment(db, orderId, "http://localhost:5173", {
      client,
      secretKey: key,
    });
    expect(result.url).toContain("https://checkout.stripe.com/");
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      idempotencyKey: `tapcart:order:${orderId}:checkout:v1`,
    });
    expect(
      (
        await db.query("SELECT count(*)::int count FROM stripe_payment_attempt WHERE order_id=$1", [
          orderId,
        ])
      ).rows[0].count,
    ).toBe(1);
  });
  it("signed success finalizes once and rejects mismatched paid totals", async () => {
    const { orderId, unit } = await fixture();
    let session: Stripe.Checkout.Session | undefined;
    vi.spyOn(client.checkout.sessions, "create").mockImplementation(async (params) => {
      session = mockSession(params!);
      return session as Stripe.Response<Stripe.Checkout.Session>;
    });
    await createStripePayment(db, orderId, "http://localhost:5173", { client, secretKey: key });
    const paid = {
      ...session!,
      status: "complete",
      payment_status: "paid",
      payment_intent: `pi_${randomUUID()}`,
    };
    const app = webhookApp(db, client);
    const bad = signedPayload(
      client,
      event("checkout.session.completed", { ...paid, amount_total: 1 }),
    );
    expect(
      (
        await request(app)
          .post("/webhook")
          .set("Content-Type", "application/json")
          .set("Stripe-Signature", bad.signature)
          .send(bad.body)
      ).status,
    ).toBe(400);
    const good = signedPayload(client, event("checkout.session.completed", paid));
    for (let repeat = 0; repeat < 2; repeat++)
      expect(
        (
          await request(app)
            .post("/webhook")
            .set("Content-Type", "application/json")
            .set("Stripe-Signature", good.signature)
            .send(good.body)
        ).status,
      ).toBe(200);
    expect(
      (await db.query("SELECT status,payment_reference FROM customer_order WHERE id=$1", [orderId]))
        .rows[0],
    ).toMatchObject({ status: "COMPLETED", payment_reference: paid.payment_intent });
    expect(
      (await db.query("SELECT count(*)::int count FROM unit_sale WHERE unit_id=$1", [unit])).rows[0]
        .count,
    ).toBe(1);
  });
  it("late paid success after failed timeout and inventory expiry enters refund review", async () => {
    const { orderId, unit } = await fixture();
    let session: Stripe.Checkout.Session | undefined;
    vi.spyOn(client.checkout.sessions, "create").mockImplementation(async (params) => {
      session = mockSession(params!);
      return session as Stripe.Response<Stripe.Checkout.Session>;
    });
    await createStripePayment(db, orderId, "http://localhost:5173", { client, secretKey: key });
    await db.query(
      "UPDATE inventory_unit SET reserved_until=now()-interval '2 seconds',checkout_protected_until=now()-interval '1 second' WHERE id=$1",
      [unit],
    );
    await expireReservations(db);
    await db.query("UPDATE customer_order SET status='PAYMENT_FAILED' WHERE id=$1", [orderId]);
    const signed = signedPayload(
      client,
      event("checkout.session.completed", {
        ...session!,
        status: "complete",
        payment_status: "paid",
        payment_intent: `pi_${randomUUID()}`,
      }),
    );
    const result = await request(webhookApp(db, client))
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", signed.signature)
      .send(signed.body);
    expect(result.status).toBe(200);
    expect(
      (await db.query("SELECT status,refund_due_cents FROM customer_order WHERE id=$1", [orderId]))
        .rows[0],
    ).toMatchObject({ status: "REFUND_PENDING", refund_due_cents: 39900 });
    expect(
      (await db.query("SELECT status FROM inventory_unit WHERE id=$1", [unit])).rows[0].status,
    ).toBe("AVAILABLE");
  });
  it("refunds a returned card unit once after a lost provider response", async () => {
    const { orderId, unit } = await fixture();
    vi.spyOn(client.checkout.sessions, "create").mockImplementation(
      async (params) => mockSession(params!, true) as Stripe.Response<Stripe.Checkout.Session>,
    );
    await createStripePayment(db, orderId, "http://localhost:5173", { client, secretKey: key });
    const current = (await db.query("SELECT version FROM inventory_unit WHERE id=$1", [unit]))
      .rows[0];
    await db.transaction((connection) =>
      returnUnit(connection, unit, {
        orderId,
        version: Number(current.version),
        reason: "Returned unopened by customer",
      }),
    );
    let providerRefund: Stripe.Refund | undefined;
    const create = vi.spyOn(client.refunds, "create").mockImplementation(async (params) => {
      if (!providerRefund) {
        providerRefund = {
          id: `re_${randomUUID()}`,
          object: "refund",
          amount: params!.amount,
          currency: "inr",
          payment_intent: params!.payment_intent,
          status: "succeeded",
          metadata: params!.metadata,
        } as Stripe.Refund;
        throw new Error("Response lost after refund");
      }
      return providerRefund as Stripe.Response<Stripe.Refund>;
    });
    await expect(createStripeRefund(db, orderId, { client, secretKey: key })).rejects.toMatchObject(
      { status: 502 },
    );
    const result = await createStripeRefund(db, orderId, { client, secretKey: key });
    expect(result.status).toBe("SUCCEEDED");
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    await applyStripeRefund(db, providerRefund);
    const order = (
      await db.query(
        "SELECT status,refunded_cents,refund_due_cents FROM customer_order WHERE id=$1",
        [orderId],
      )
    ).rows[0];
    expect(order).toMatchObject({ status: "REFUNDED", refunded_cents: 39900, refund_due_cents: 0 });
    expect(
      (await db.query("SELECT count(*)::int count FROM order_refund WHERE order_id=$1", [orderId]))
        .rows[0].count,
    ).toBe(1);
    await expect(applyStripeRefund(db, { ...providerRefund, amount: 1 })).rejects.toMatchObject({
      status: 400,
    });
  });
});
