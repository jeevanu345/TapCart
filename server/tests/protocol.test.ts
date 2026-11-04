import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createDatabase, migrate } from "../db.js";
import { createApp } from "../app.js";
import { seedDevelopment } from "../seed.js";
import { expireReservations, reconcilePayments, recordPayment } from "../protocol.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test"))
  throw new Error("Set TEST_DATABASE_URL to an isolated database whose name includes test.");
const suite = describe;
suite("PostgreSQL transactional NFC protocol", () => {
  const db = createDatabase(databaseUrl!);
  const app = createApp(db, {
    origin: "http://localhost:5173",
    developmentPayments: true,
    production: false,
  });
  let customer: { agent: ReturnType<typeof request.agent>; csrf: string };
  let store: typeof customer;
  let admin: typeof customer;
  let unitId: string;
  async function login(email: string) {
    const agent = request.agent(app);
    const session = await agent.get("/api/auth/session");
    const result = await agent
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ email, password: "TapCartDemo123!" });
    expect(result.status).toBe(200);
    return { agent, csrf: result.body.csrfToken as string };
  }
  const write = (
    actor: typeof customer,
    method: "post" | "delete",
    url: string,
    body: unknown,
    key = randomUUID(),
  ) =>
    actor.agent[method](url)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", actor.csrf)
      .set("Idempotency-Key", key)
      .send(body);
  beforeAll(async () => {
    await migrate(db);
  });
  beforeEach(async () => {
    await db.query(
      "TRUNCATE outbox, payment_event, unit_sale, order_unit, inventory_unit, customer_order, idempotency_record, product, session, store, app_user CASCADE",
    );
    await seedDevelopment(db);
    customer = await login("shopper@tapcart.local");
    store = await login("store@tapcart.local");
    admin = await login("admin@tapcart.local");
    unitId = (
      await db.query("SELECT id FROM inventory_unit WHERE status='AVAILABLE' ORDER BY id LIMIT 1")
    ).rows[0].id;
  });
  afterAll(async () => {
    await db.pool.end();
  });
  async function reserve(actor = customer, id = unitId) {
    const current = (await actor.agent.get(`/api/units/${id}`)).body;
    return write(actor, "post", "/api/reservations", { unitId: id, version: current.version });
  }
  async function checkout(method = "DESK") {
    const reservation = await reserve();
    expect(reservation.status).toBe(201);
    const order = await write(customer, "post", "/api/orders", {
      items: [
        {
          unitId,
          reservationId: reservation.body.reservationId,
          version: reservation.body.version,
        },
      ],
      method,
    });
    expect(order.status).toBe(201);
    return { order: order.body, reservation: reservation.body };
  }
  it("only one of twenty independent concurrent shoppers owns a hot unit", async () => {
    const actors = await Promise.all(
      Array.from({ length: 20 }, () => login("shopper@tapcart.local")),
    );
    const results = await Promise.all(
      actors.map((actor) => write(actor, "post", "/api/reservations", { unitId, version: 0 })),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(19);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM inventory_unit WHERE id=$1 AND status='RESERVED'",
          [unitId],
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it("replays durable keys without a second mutation and rejects changed payloads", async () => {
    const key = randomUUID(),
      body = { unitId, version: 0 };
    const results = await Promise.all([
      write(customer, "post", "/api/reservations", body, key),
      write(customer, "post", "/api/reservations", body, key),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.reservationId).toBe(results[1].body.reservationId);
    expect(
      (await write(customer, "post", "/api/reservations", { ...body, version: 1 }, key)).status,
    ).toBe(409);
    expect(
      (await db.query("SELECT version FROM inventory_unit WHERE id=$1", [unitId])).rows[0].version,
    ).toBe("1");
  });
  it("rejects another session, stale release, and active checkout rebinding", async () => {
    const { order, reservation } = await checkout();
    const other = await login("shopper@tapcart.local");
    expect(
      (
        await write(other, "delete", `/api/reservations/${reservation.reservationId}`, {
          version: reservation.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await write(customer, "delete", `/api/reservations/${reservation.reservationId}`, {
          version: reservation.version,
        })
      ).status,
    ).toBe(409);
    const current = (await customer.agent.get(`/api/units/${unitId}`)).body;
    const second = await write(customer, "post", "/api/orders", {
      items: [{ unitId, reservationId: reservation.reservationId, version: current.version }],
      method: "DESK",
    });
    expect(second.status).toBe(409);
    expect(
      (await db.query("SELECT checkout_order_id FROM inventory_unit WHERE id=$1", [unitId])).rows[0]
        .checkout_order_id,
    ).toBe(order.id);
  });
  it("concurrent duplicate checkout creates one order and exact protected binding", async () => {
    const reservation = (await reserve()).body,
      key = randomUUID();
    const body = {
      items: [{ unitId, reservationId: reservation.reservationId, version: reservation.version }],
      method: "DESK",
    };
    const results = await Promise.all([
      write(customer, "post", "/api/orders", body, key),
      write(customer, "post", "/api/orders", body, key),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM customer_order WHERE payment_method='DESK'",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (await db.query("SELECT version FROM inventory_unit WHERE id=$1", [unitId])).rows[0].version,
    ).toBe("2");
  });
  it("cash confirmation is owner authorized, sold once per epoch, and return starts a new epoch", async () => {
    const { order } = await checkout();
    expect(
      (await write(customer, "post", `/api/orders/${order.id}/confirm-payment`, {})).status,
    ).toBe(403);
    const payment = await write(store, "post", `/api/orders/${order.id}/confirm-payment`, {});
    expect(payment.status).toBe(200);
    expect(payment.body.status).toBe("COMPLETED");
    const unit = (await customer.agent.get(`/api/units/${unitId}`)).body;
    expect(unit.status).toBe("SOLD");
    const body = { orderId: order.id, version: unit.version, reason: "Unopened customer return" };
    const returned = await write(store, "post", `/api/units/${unitId}/return`, body);
    expect(returned.status).toBe(200);
    expect(returned.body.saleEpoch).toBe(1);
    expect((await write(store, "post", `/api/units/${unitId}/return`, body)).status).toBe(409);
    expect(
      (await db.query("SELECT count(*)::int AS count FROM unit_sale WHERE unit_id=$1", [unitId]))
        .rows[0].count,
    ).toBe(1);
  });
  it("expiry workers reclaim disjoint unprotected leases and retain protected checkout", async () => {
    const { order } = await checkout();
    await db.query(
      "UPDATE inventory_unit SET reserved_until=now()-interval '1 second' WHERE id=$1",
      [unitId],
    );
    await Promise.all([expireReservations(db), expireReservations(db)]);
    expect(
      (await db.query("SELECT checkout_order_id FROM inventory_unit WHERE id=$1", [unitId])).rows[0]
        .checkout_order_id,
    ).toBe(order.id);
    await db.query(
      "UPDATE inventory_unit SET checkout_protected_until=now()-interval '1 second' WHERE id=$1",
      [unitId],
    );
    await Promise.all([expireReservations(db), expireReservations(db)]);
    expect(
      (await db.query("SELECT status,version FROM inventory_unit WHERE id=$1", [unitId])).rows[0],
    ).toEqual({ status: "AVAILABLE", version: "3" });
  });
  it("payment after expiry enters refund review without taking a new reservation", async () => {
    const { order } = await checkout("DEVELOPMENT");
    await db.query(
      "UPDATE inventory_unit SET reserved_until=now()-interval '2 seconds', checkout_protected_until=now()-interval '1 second' WHERE id=$1",
      [unitId],
    );
    await expireReservations(db);
    const other = await login("shopper@tapcart.local");
    const reservation = await reserve(other);
    expect(reservation.status).toBe(201);
    const result = await write(customer, "post", `/api/orders/${order.id}/development-payment`, {
      outcome: "SUCCEEDED",
    });
    expect(result.body.status).toBe("REFUND_PENDING");
    expect(
      (await db.query("SELECT reservation_id FROM inventory_unit WHERE id=$1", [unitId])).rows[0]
        .reservation_id,
    ).toBe(reservation.body.reservationId);
    await reconcilePayments(db);
    expect(
      (await db.query("SELECT count(*)::int AS count FROM unit_sale WHERE unit_id=$1", [unitId]))
        .rows[0].count,
    ).toBe(0);
  });
  it("rejects CSRF, requires administrator approval, and scopes product mutations", async () => {
    expect(
      (await customer.agent.post("/api/reservations").send({ unitId, version: 0 })).status,
    ).toBe(403);
    const pending = await admin.agent.get("/api/stores");
    const storeId = pending.body.find((s: { status: string }) => s.status === "PENDING")?.id;
    expect(storeId).toBeTruthy();
    expect(
      (await write(store, "post", `/api/stores/${storeId}/approval`, { approved: true })).status,
    ).toBe(403);
    expect(
      (await write(admin, "post", `/api/stores/${storeId}/approval`, { approved: true })).status,
    ).toBe(200);
    const products = await customer.agent.get("/api/products");
    expect(
      (
        await write(customer, "post", "/api/products", {
          name: "Unauthorized",
          sku: "NO",
          priceCents: 1,
          category: "Test",
        })
      ).status,
    ).toBe(403);
    expect(products.body.length).toBeGreaterThan(0);
  });
  it("persists a failed idempotent response even if inventory later changes", async () => {
    const reserved = await reserve(),
      key = randomUUID(),
      input = { unitId, version: 0 };
    expect((await write(customer, "post", "/api/reservations", input, key)).status).toBe(409);
    expect(
      (
        await write(customer, "delete", `/api/reservations/${reserved.body.reservationId}`, {
          version: reserved.body.version,
        })
      ).status,
    ).toBe(200);
    const replay = await write(customer, "post", "/api/reservations", input, key);
    expect(replay.status).toBe(409);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(
      (await db.query("SELECT status FROM inventory_unit WHERE id=$1", [unitId])).rows[0].status,
    ).toBe("AVAILABLE");
  });
  it("rolls back every unit if a multi-unit checkout loses one reservation", async () => {
    const first = (await reserve()).body;
    const nextId = (
      await db.query("SELECT id FROM inventory_unit WHERE status='AVAILABLE' AND id!=$1 LIMIT 1", [
        unitId,
      ])
    ).rows[0].id;
    const second = (await reserve(customer, nextId)).body;
    const response = await write(customer, "post", "/api/orders", {
      items: [
        { unitId, reservationId: first.reservationId, version: first.version },
        { unitId: nextId, reservationId: second.reservationId, version: 0 },
      ],
      method: "DESK",
    });
    expect(response.status).toBe(409);
    expect(
      (
        await db.query(
          "SELECT checkout_order_id,version FROM inventory_unit WHERE id=ANY($1::uuid[])",
          [[unitId, nextId]],
        )
      ).rows.every((row) => row.checkout_order_id === null && row.version === "1"),
    ).toBe(true);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM customer_order WHERE payment_method='DESK'",
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("captures late successful settlement after a known failure as a refund liability", async () => {
    const { order } = await checkout("DEVELOPMENT");
    await db.transaction((client) =>
      recordPayment(client, order.id, "provider:decline", "FAILED", "TEST_PROVIDER"),
    );
    const result = await db.transaction((client) =>
      recordPayment(client, order.id, "provider:late-success", "SUCCEEDED", "TEST_PROVIDER"),
    );
    expect(result.status).toBe(200);
    const current = await customer.agent.get(`/api/orders/${order.id}`);
    expect(current.body.status).toBe("REFUND_PENDING");
    expect(current.body.refundDueCents).toBe(order.totalCents);
    expect(
      (
        await db.query("SELECT count(*)::int AS count FROM payment_event WHERE order_id=$1", [
          order.id,
        ])
      ).rows[0].count,
    ).toBe(2);
  });
  it("rejects cross-store catalog edits, unit provisioning, and order confirmation", async () => {
    const agent = request.agent(app),
      session = await agent.get("/api/auth/session");
    const registration = await agent
      .post("/api/auth/register")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({
        name: "Other owner",
        email: "other@tapcart.test",
        password: "AnotherSecure123!",
        role: "STORE",
        storeName: "Other Store",
      });
    expect(registration.status).toBe(201);
    const other = { agent, csrf: registration.body.csrfToken };
    await write(admin, "post", `/api/stores/${registration.body.user.storeId}/approval`, {
      approved: true,
    });
    const products = (await store.agent.get("/api/products")).body,
      product = products[0];
    const patch = await other.agent
      .patch(`/api/products/${product.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", other.csrf)
      .send({ name: "Hijacked" });
    expect(patch.status).toBe(404);
    expect(
      (await write(other, "post", "/api/units", { productId: product.id, quantity: 2 })).status,
    ).toBe(404);
    const { order } = await checkout();
    expect((await write(other, "post", `/api/orders/${order.id}/confirm-payment`, {})).status).toBe(
      404,
    );
  });
  it("tracks partial cash refunds and subsequent returns without overstating refund amounts", async () => {
    const first = (await reserve()).body,
      nextId = (
        await db.query(
          "SELECT id FROM inventory_unit WHERE status='AVAILABLE' AND id!=$1 LIMIT 1",
          [unitId],
        )
      ).rows[0].id,
      second = (await reserve(customer, nextId)).body;
    const order = (
      await write(customer, "post", "/api/orders", {
        items: [
          { unitId, reservationId: first.reservationId, version: first.version },
          { unitId: nextId, reservationId: second.reservationId, version: second.version },
        ],
        method: "DESK",
      })
    ).body;
    expect(
      (await write(store, "post", `/api/orders/${order.id}/confirm-payment`, {})).body.status,
    ).toBe("COMPLETED");
    for (const [index, returnedId] of [unitId, nextId].entries()) {
      const unit = (await store.agent.get(`/api/units/${returnedId}`)).body;
      expect(
        (
          await write(store, "post", `/api/units/${returnedId}/return`, {
            orderId: order.id,
            version: unit.version,
            reason: "Unopened goods",
          })
        ).status,
      ).toBe(200);
      const refunded = await write(store, "post", `/api/orders/${order.id}/confirm-refund`, {});
      expect(refunded.status).toBe(200);
      expect(refunded.body.refundDueCents).toBe(0);
      expect(refunded.body.status).toBe(index === 0 ? "COMPLETED" : "REFUNDED");
    }
    expect(
      (
        await db.query(
          "SELECT sum(amount_cents)::int AS amount FROM order_refund WHERE order_id=$1",
          [order.id],
        )
      ).rows[0].amount,
    ).toBe(order.totalCents);
  });
  it("keeps checkout and expiry mutually exclusive when they race", async () => {
    const reservation = (await reserve()).body;
    await db.query(
      "UPDATE inventory_unit SET reserved_until=now()-interval '1 millisecond' WHERE id=$1",
      [unitId],
    );
    const [checkoutResponse] = await Promise.all([
      write(customer, "post", "/api/orders", {
        items: [{ unitId, reservationId: reservation.reservationId, version: reservation.version }],
        method: "DESK",
      }),
      expireReservations(db),
      expireReservations(db),
    ]);
    expect(checkoutResponse.status).toBe(409);
    const row = (
      await db.query("SELECT status,checkout_order_id FROM inventory_unit WHERE id=$1", [unitId])
    ).rows[0];
    expect(row).toEqual({ status: "AVAILABLE", checkout_order_id: null });
  });
  it("does not expose reservation or order credentials in public unit and store responses", async () => {
    const { order } = await checkout();
    const unit = (await request(app).get(`/api/units/${unitId}`)).body;
    expect(unit.ownerSessionId).toBeUndefined();
    expect(unit.reservationId).toBeUndefined();
    expect(unit.checkoutOrderId).toBeUndefined();
    expect(unit.soldOrderId).toBeUndefined();
    const publicStores = (await request(app).get("/api/stores")).body;
    expect(publicStores[0].email).toBeUndefined();
    expect(publicStores[0].ownerId).toBeUndefined();
    expect((await request(app).get(`/api/orders/${order.id}`)).status).toBe(401);
  });
  it("imports CSV atomically and exports spreadsheet-safe values", async () => {
    const invalid = await write(store, "post", "/api/products/import", {
      csv: "sku,name,priceCents,quantity\nNEW-1,Good product,100,2\nNEW-2,Bad product,-1,2",
    });
    expect(invalid.status).toBe(400);
    expect(
      (await db.query("SELECT count(*)::int AS count FROM product WHERE sku='NEW-1'")).rows[0]
        .count,
    ).toBe(0);
    const imported = await write(store, "post", "/api/products/import", {
      csv: 'sku,name,priceCents,quantity\nCSV-1,"=HYPERLINK(""bad"")",100,2',
    });
    expect(imported.status).toBe(201);
    expect(imported.body).toEqual({ products: 1, units: 2 });
    const exported = await store.agent.get("/api/exports/products");
    expect(exported.status).toBe(200);
    expect(exported.text).toContain("'=HYPERLINK");
  });
  it("returns zero-value goods without inventing a financial refund", async () => {
    await db.query(
      "UPDATE product SET price_cents=0 WHERE id=(SELECT product_id FROM inventory_unit WHERE id=$1)",
      [unitId],
    );
    const { order } = await checkout();
    expect((await write(store, "post", `/api/orders/${order.id}/confirm-payment`, {})).status).toBe(
      200,
    );
    const unit = (await customer.agent.get(`/api/units/${unitId}`)).body;
    expect(
      (
        await write(store, "post", `/api/units/${unitId}/return`, {
          orderId: order.id,
          version: unit.version,
          reason: "Returned free promotional unit",
        })
      ).status,
    ).toBe(200);
    const returned = (await store.agent.get(`/api/orders/${order.id}`)).body;
    expect(returned.refundDueCents).toBe(0);
    expect(returned.status).toBe("COMPLETED");
  });
  it("reports a full thirty-day calendar series and completed-purchase customers", async () => {
    const report = await store.agent.get("/api/analytics");
    expect(report.status).toBe(200);
    expect(report.body.dailySales).toHaveLength(30);
    expect(
      report.body.dailySales.every(
        (day: { revenueCents: number; orders: number }) =>
          Number.isFinite(day.revenueCents) && day.orders >= 0,
      ),
    ).toBe(true);
    const { order } = await checkout();
    const before = (await store.agent.get("/api/customers")).body[0].orders;
    await write(store, "post", `/api/orders/${order.id}/confirm-payment`, {});
    expect((await store.agent.get("/api/customers")).body[0].orders).toBe(before + 1);
  });
  it("receives the same physical stock batch once when its response is retried", async () => {
    const productId = (
      await db.query("SELECT product_id FROM inventory_unit WHERE id=$1", [unitId])
    ).rows[0].product_id;
    const before = (
      await db.query("SELECT count(*)::int count FROM inventory_unit WHERE product_id=$1", [
        productId,
      ])
    ).rows[0].count;
    const key = randomUUID(),
      body = { productId, quantity: 3 };
    const first = await write(store, "post", "/api/units", body, key);
    const replay = await write(store, "post", "/api/units", body, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(
      (
        await db.query("SELECT count(*)::int count FROM inventory_unit WHERE product_id=$1", [
          productId,
        ])
      ).rows[0].count,
    ).toBe(before + 3);
  });
  it("lets administrators settle owed refunds after a store is revoked", async () => {
    const { order } = await checkout();
    await write(store, "post", `/api/orders/${order.id}/confirm-payment`, {});
    const unit = (await customer.agent.get(`/api/units/${unitId}`)).body;
    await write(store, "post", `/api/units/${unitId}/return`, {
      orderId: order.id,
      version: unit.version,
      reason: "Returned before store revocation",
    });
    await write(admin, "post", `/api/stores/${order.storeId}/approval`, { approved: false });
    expect((await write(store, "post", `/api/orders/${order.id}/confirm-refund`, {})).status).toBe(
      403,
    );
    const refund = await write(admin, "post", `/api/orders/${order.id}/confirm-refund`, {});
    expect(refund.status).toBe(200);
    expect(refund.body.status).toBe("REFUNDED");
  });
});
