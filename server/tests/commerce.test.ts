import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createDatabase, migrate } from "../db.js";
import { createApp } from "../app.js";
import { tokenHash } from "../auth.js";
import { allocateDiscount } from "../commerce/pricing.js";
import { checkout, idempotent, recordPayment, reserve, returnUnit } from "../protocol.js";
import type { Auth, Order } from "../types.js";

describe("integer discount allocation", () => {
  it("allocates exact discounts without negative units even for rounding and free items", () => {
    for (const prices of [
      [1, 1, 1],
      [0, 100, 299],
      [100000000, 99999999, 1],
      [0, 0],
    ]) {
      const total = prices.reduce((sum, p) => sum + p, 0);
      for (const discount of [0, Math.floor(total / 3), total]) {
        const parts = allocateDiscount(prices, discount);
        expect(parts.reduce((sum, p) => sum + p, 0)).toBe(discount);
        parts.forEach((value, index) =>
          expect(value >= 0 && value <= prices[index] && Number.isInteger(value)).toBe(true),
        );
      }
    }
  });
});
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test"))
  throw new Error("Set TEST_DATABASE_URL to an isolated test database.");
describe("commerce PostgreSQL transactions", () => {
  const db = createDatabase(databaseUrl!);
  const origin = "http://localhost:5173",
    app = createApp(db, {
      origin,
      production: false,
      developmentPayments: true,
      cardPayments: false,
    });
  type Actor = { auth: Auth; cookie: string; csrf: string };
  let owner: Actor,
    manager: Actor,
    staff: Actor,
    customer: Actor,
    storeId: string,
    productId: string,
    supplierId: string;
  async function actor(
    role: "STORE" | "CUSTOMER",
    storeRole: "OWNER" | "MANAGER" | "STAFF" | null = null,
  ): Promise<Actor> {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(32).toString("base64url");
    await db.query(
      "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,'Commerce fixture',$2,'unused',$3)",
      [userId, `${userId}@test.local`, role],
    );
    if (storeRole === "OWNER") {
      storeId = randomUUID();
      await db.query(
        "INSERT INTO store(id,owner_id,name,status) VALUES($1,$2,'Commerce fixture','APPROVED')",
        [storeId, userId],
      );
    } else if (storeRole)
      await db.query("INSERT INTO store_member(user_id,store_id,role) VALUES($1,$2,$3)", [
        userId,
        storeId,
        storeRole,
      ]);
    await db.query(
      "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [sessionId, userId, tokenHash(token), csrf],
    );
    return {
      auth: {
        user: {
          id: userId,
          name: "Commerce fixture",
          email: `${userId}@test.local`,
          role,
          storeId: role === "STORE" ? storeId : null,
          storeRole,
        },
        sessionId,
        csrfToken: csrf,
      },
      cookie: `tapcart_session=${token}`,
      csrf,
    };
  }
  const send = (
    who: Actor,
    path: string,
    body: unknown,
    key = randomUUID(),
    method: "post" | "patch" = "post",
  ) => {
    const client = request(app);
    return client[method](path)
      .set("Cookie", who.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", who.csrf)
      .set("Idempotency-Key", key)
      .send(body);
  };
  beforeAll(() => migrate(db));
  beforeEach(async () => {
    owner = await actor("STORE", "OWNER");
    manager = await actor("STORE", "MANAGER");
    staff = await actor("STORE", "STAFF");
    customer = await actor("CUSTOMER");
    productId = randomUUID();
    supplierId = randomUUID();
    await db.query(
      "INSERT INTO product(id,store_id,sku,name,price_cents) VALUES($1,$2,$3,'Commerce product',101)",
      [productId, storeId, productId],
    );
    await db.query("INSERT INTO supplier(id,store_id,name) VALUES($1,$2,'Commerce supplier')", [
      supplierId,
      storeId,
    ]);
  });
  afterAll(() => db.pool.end());
  async function purchase(quantity = 3) {
    const response = await send(owner, "/api/purchasing/orders", {
      supplierId,
      invoiceNumber: "INV-1",
      lines: [{ productId, quantity, unitCostCents: 63 }],
    });
    expect(response.status).toBe(201);
    return response.body as { id: string; lines: { id: string }[] };
  }
  async function cart(who: Actor, count = 2) {
    const items = [];
    for (let i = 0; i < count; i++) {
      const unitId = randomUUID();
      await db.query(
        "INSERT INTO inventory_unit(id,store_id,product_id,staff_code) VALUES($1,$2,$3,$4)",
        [unitId, storeId, productId, unitId],
      );
      const reserved = await db.transaction((client) =>
        reserve(client, who.auth, { unitId, version: 0 }),
      );
      const unit = reserved.body as { reservationId: string; version: number };
      items.push({ unitId, reservationId: unit.reservationId, version: unit.version });
    }
    return items;
  }
  async function coupon(input: Record<string, unknown> = {}) {
    const code = `CODE-${randomUUID().slice(0, 8)}`.toUpperCase();
    const response = await send(owner, "/api/coupons", {
      code,
      type: "FIXED",
      value: 51,
      ...input,
    });
    expect(response.status).toBe(201);
    return response.body as { id: string; code: string };
  }
  it("requires managers for writes and rejects cross-store catalog references", async () => {
    expect((await send(staff, "/api/suppliers", { name: "Staff supplier" })).status).toBe(403);
    expect(
      (
        await send(customer, "/api/purchasing/drafts", {
          lines: [{ productId, quantity: 1, unitCostCents: 20 }],
        })
      ).status,
    ).toBe(403);
    expect(
      (await send(manager, "/api/suppliers", { name: "Manager supplier", leadTimeDays: 4 })).status,
    ).toBe(201);
    expect(
      (
        await send(owner, "/api/purchasing/drafts", {
          supplierId,
          lines: [{ productId: randomUUID(), quantity: 1, unitCostCents: 20 }],
        })
      ).status,
    ).toBe(400);
  });
  it("keeps invoice drafts separate from approval and physical receiving", async () => {
    const draft = await send(owner, "/api/purchasing/drafts", {
      supplierId,
      invoiceNumber: "OCR-123",
      lines: [{ productId, quantity: 3, unitCostCents: 42 }],
    });
    expect(draft.status).toBe(201);
    const units = () =>
      db.query("SELECT count(*)::int AS count FROM inventory_unit WHERE store_id=$1", [storeId]);
    expect((await units()).rows[0].count).toBe(0);
    const approved = await send(manager, `/api/purchasing/drafts/${draft.body.id}/approve`, {});
    expect(approved.status).toBe(201);
    expect((await units()).rows[0].count).toBe(0);
    expect((await send(owner, `/api/purchasing/drafts/${draft.body.id}/approve`, {})).status).toBe(
      409,
    );
    const received = await send(manager, `/api/purchasing/orders/${approved.body.id}/receive`, {
      lines: [{ lineId: approved.body.lines[0].id, quantity: 1 }],
    });
    expect(received.status).toBe(201);
    expect(received.body.order.status).toBe("PARTIAL");
    expect((await units()).rows[0].count).toBe(1);
  });
  it("replays receipts and prevents concurrent oversupply atomically", async () => {
    const po = await purchase(3),
      body = { reference: "DEL-1", lines: [{ lineId: po.lines[0].id, quantity: 2 }] },
      key = randomUUID();
    const first = await send(owner, `/api/purchasing/orders/${po.id}/receive`, body, key);
    expect(first.status).toBe(201);
    const replay = await send(owner, `/api/purchasing/orders/${po.id}/receive`, body, key);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body.units).toEqual(first.body.units);
    const concurrent = await Promise.all([
      send(owner, `/api/purchasing/orders/${po.id}/receive`, {
        lines: [{ lineId: po.lines[0].id, quantity: 1 }],
      }),
      send(manager, `/api/purchasing/orders/${po.id}/receive`, {
        lines: [{ lineId: po.lines[0].id, quantity: 1 }],
      }),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
    const units = (await db.query("SELECT * FROM inventory_unit WHERE store_id=$1", [storeId]))
      .rows;
    expect(units).toHaveLength(3);
    expect(new Set(units.map((unit) => unit.staff_code)).size).toBe(3);
    expect(units.every((unit) => unit.unit_cost_cents === 63 && unit.status === "AVAILABLE")).toBe(
      true,
    );
  });
  it("serializes receipt capacity against manual inventory additions", async () => {
    const po = await purchase(1),
      ids = Array.from({ length: 1999 }, () => randomUUID());
    await db.query(
      "INSERT INTO inventory_unit(id,store_id,product_id,staff_code) SELECT id,$2,$3,id::text FROM unnest($1::uuid[]) id",
      [ids, storeId, productId],
    );
    const outcomes = await Promise.all([
      send(owner, `/api/purchasing/orders/${po.id}/receive`, {
        lines: [{ lineId: po.lines[0].id, quantity: 1 }],
      }),
      send(owner, "/api/units", { productId, quantity: 1 }),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([201, 402]);
    expect(
      (
        await db.query("SELECT count(*)::int AS count FROM inventory_unit WHERE store_id=$1", [
          storeId,
        ])
      ).rows[0].count,
    ).toBe(2000);
  });
  it("quotes without consuming uses, then snapshots exact paid/refund amounts", async () => {
    const promotion = await coupon(),
      items = await cart(customer);
    const quote = await send(customer, "/api/coupons/quote", {
      unitIds: items.map((item) => item.unitId),
      couponCode: promotion.code,
    });
    expect(quote.status).toBe(200);
    expect(quote.body.totalCents).toBe(151);
    expect(
      (await db.query("SELECT uses FROM coupon WHERE id=$1", [promotion.id])).rows[0].uses,
    ).toBe(0);
    const result = await idempotent(
      db,
      `commerce-checkout:${customer.auth.sessionId}`,
      randomUUID(),
      { items },
      (client) =>
        checkout(client, customer.auth, { items, method: "DESK", couponCode: promotion.code }),
    );
    const order = result.body as Order;
    expect(order.totalCents).toBe(151);
    expect(order.discountCents).toBe(51);
    expect(order.items.reduce((sum, item) => sum + item.priceCents, 0)).toBe(order.totalCents);
    expect(order.items.map((item) => item.priceCents).sort()).toEqual([75, 76]);
    await db.transaction((client) =>
      recordPayment(client, order.id, `commerce:${order.id}`, "SUCCEEDED", "DESK"),
    );
    const unit = (
      await db.query("SELECT version FROM inventory_unit WHERE id=$1", [order.items[0].unitId])
    ).rows[0];
    await db.transaction((client) =>
      returnUnit(client, order.items[0].unitId, {
        orderId: order.id,
        version: Number(unit.version),
        reason: "Fixture return",
      }),
    );
    expect(
      (await db.query("SELECT refund_due_cents FROM customer_order WHERE id=$1", [order.id]))
        .rows[0].refund_due_cents,
    ).toBe(order.items[0].priceCents);
  });
  it("enforces coupon date windows, minimum spend, percentage bounds and customer limits", async () => {
    const items = await cart(customer, 1);
    const quote = (code: string) =>
      send(customer, "/api/coupons/quote", {
        unitIds: items.map((item) => item.unitId),
        couponCode: code,
      });
    const expired = await coupon({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await quote(expired.code)).status).toBe(409);
    const future = await coupon({ startsAt: new Date(Date.now() + 3600_000).toISOString() });
    expect((await quote(future.code)).status).toBe(409);
    const minimum = await coupon({ minimumSpendCents: 102 });
    expect((await quote(minimum.code)).status).toBe(400);
    expect(
      (await send(owner, "/api/coupons", { code: "INVALID", type: "PERCENT", value: 101 })).status,
    ).toBe(400);
    const limited = await coupon({ perCustomerLimit: 1 });
    await db.transaction((client) =>
      checkout(client, customer.auth, { items, method: "DESK", couponCode: limited.code }),
    );
    const second = await cart(customer, 1);
    await expect(
      db.transaction((client) =>
        checkout(client, customer.auth, {
          items: second,
          method: "DESK",
          couponCode: limited.code,
        }),
      ),
    ).rejects.toThrow("usage limit");
    expect((await db.query("SELECT uses FROM coupon WHERE id=$1", [limited.id])).rows[0].uses).toBe(
      1,
    );
  });
  it("claims the last coupon use once under simultaneous checkouts", async () => {
    const promotion = await coupon({ maxUses: 1 }),
      other = await actor("CUSTOMER"),
      [first, second] = await Promise.all([cart(customer, 1), cart(other, 1)]);
    const outcomes = await Promise.allSettled([
      db.transaction((client) =>
        checkout(client, customer.auth, {
          items: first,
          method: "DESK",
          couponCode: promotion.code,
        }),
      ),
      db.transaction((client) =>
        checkout(client, other.auth, { items: second, method: "DESK", couponCode: promotion.code }),
      ),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db.query("SELECT uses FROM coupon WHERE id=$1", [promotion.id])).rows[0].uses,
    ).toBe(1);
    expect(
      (
        await db.query("SELECT count(*)::int AS count FROM coupon_redemption WHERE coupon_id=$1", [
          promotion.id,
        ])
      ).rows[0].count,
    ).toBe(1);
  });
  it("rolls a coupon claim back when an expired reservation rejects checkout", async () => {
    const promotion = await coupon({ perCustomerLimit: 1 }),
      items = await cart(customer, 1);
    await db.query(
      "UPDATE inventory_unit SET reserved_until=now()-interval '1 minute' WHERE id=$1",
      [items[0].unitId],
    );
    await expect(
      db.transaction((client) =>
        checkout(client, customer.auth, { items, method: "DESK", couponCode: promotion.code }),
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT uses FROM coupon WHERE id=$1", [promotion.id])).rows[0].uses,
    ).toBe(0);
  });
  it("scopes reconciliation records and prevents staff or customers from checking payments", async () => {
    const items = await cart(customer, 1),
      result = await db.transaction((client) =>
        checkout(client, customer.auth, { items, method: "DESK" }),
      ),
      order = result.body as Order;
    const own = await request(app).get("/api/reconciliation").set("Cookie", owner.cookie);
    expect(own.status).toBe(200);
    expect(own.body.map((row: { id: string }) => row.id)).toContain(order.id);
    expect(own.body.find((row: { id: string }) => row.id === order.id).discrepancies).toEqual([]);
    expect((await request(app).get("/api/reconciliation").set("Cookie", staff.cookie)).status).toBe(
      403,
    );
    expect(
      (await send(customer, `/api/reconciliation/${order.id}/reconcile`, { action: "PAYMENT" }))
        .status,
    ).toBe(403);
    const other = await actor("STORE", "OWNER");
    const scoped = await request(app).get("/api/reconciliation").set("Cookie", other.cookie);
    expect(scoped.status).toBe(200);
    expect(scoped.body).toEqual([]);
  });
});
