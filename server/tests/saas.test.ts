import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createDatabase, migrate } from "../db.js";
import { createApp } from "../app.js";
import { seedDevelopment } from "../seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test"))
  throw new Error("Set TEST_DATABASE_URL to an isolated database whose name includes test.");
const origin = "http://localhost:5173";
describe("SaaS workspace", () => {
  const db = createDatabase(databaseUrl!);
  const app = createApp(db, { origin, developmentPayments: true, production: false });
  type Actor = { agent: ReturnType<typeof request.agent>; csrf: string };
  let store: Actor, admin: Actor, shopper: Actor;
  async function login(email: string, password = "TapCartDemo123!") {
    const agent = request.agent(app);
    const session = await agent.get("/api/auth/session");
    const result = await agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ email, password });
    expect(result.status).toBe(200);
    return { agent, csrf: result.body.csrfToken as string };
  }
  const send = (
    actor: Actor,
    method: "post" | "patch" | "delete",
    url: string,
    body: unknown = {},
  ) => actor.agent[method](url).set("Origin", origin).set("X-CSRF-Token", actor.csrf).send(body);
  async function join(role: "MANAGER" | "STAFF", email: string) {
    const invite = await send(store, "post", "/api/team/invites", { role, email: "" });
    expect(invite.status).toBe(201);
    const agent = request.agent(app);
    const session = await agent.get("/api/auth/session");
    const accepted = await agent
      .post(`/api/invites/${invite.body.token}/accept`)
      .set("Origin", origin)
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ name: "New Teammate", email, password: "TeammatePass123!" });
    expect(accepted.status).toBe(201);
    return {
      actor: { agent, csrf: accepted.body.csrfToken as string },
      token: invite.body.token as string,
      id: accepted.body.user.id as string,
    };
  }
  beforeAll(() => migrate(db));
  beforeEach(async () => {
    await db.query(
      "TRUNCATE outbox, event_delivery, payment_event, unit_sale, order_unit, inventory_unit, customer_order, idempotency_record, product, session, store_invite, store_member, store, app_user CASCADE",
    );
    await seedDevelopment(db);
    store = await login("store@tapcart.local");
    admin = await login("admin@tapcart.local");
    shopper = await login("shopper@tapcart.local");
  });
  afterAll(() => db.pool.end());

  it("invited staff work in the store, cannot manage it, and lose access when removed", async () => {
    const { actor, id } = await join("STAFF", "staff@tapcart.local");
    const session = await actor.agent.get("/api/auth/session");
    expect(session.body.user).toMatchObject({ role: "STORE", storeRole: "STAFF" });
    expect(session.body.user.storeId).toBeTruthy();
    expect((await actor.agent.get("/api/products")).status).toBe(200);
    expect(
      (await send(actor, "post", "/api/team/invites", { role: "STAFF", email: "" })).status,
    ).toBe(403);
    expect(
      (
        await send(actor, "patch", "/api/workspace", {
          name: "Hijacked",
          address: "",
          phone: "",
          supportEmail: "",
          lowStockThreshold: 1,
        })
      ).status,
    ).toBe(403);
    expect((await send(store, "delete", `/api/team/members/${id}`)).status).toBe(200);
    expect((await actor.agent.get("/api/dashboard")).status).toBe(403);
  });
  it("an invitation works once, and only stores its hash", async () => {
    const { token } = await join("MANAGER", "mgr@tapcart.local");
    const stored = await db.query("SELECT token_hash FROM store_invite");
    expect(stored.rows.every((row) => row.token_hash !== token)).toBe(true);
    const agent = request.agent(app);
    const session = await agent.get("/api/auth/session");
    const again = await agent
      .post(`/api/invites/${token}/accept`)
      .set("Origin", origin)
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ name: "Second", email: "second@tapcart.local", password: "TeammatePass123!" });
    expect(again.status).toBe(404);
    expect((await request(app).get(`/api/invites/${token}`)).status).toBe(404);
  });
  it("a revoked invitation cannot be opened and another store's staff cannot touch it", async () => {
    const invite = await send(store, "post", "/api/team/invites", { role: "STAFF", email: "" });
    expect(
      (await request(app).get(`/api/invites/${invite.body.token}`)).body.storeName,
    ).toBeTruthy();
    expect((await send(shopper, "delete", `/api/team/invites/${invite.body.id}`)).status).toBe(403);
    expect((await send(store, "delete", `/api/team/invites/${invite.body.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/invites/${invite.body.token}`)).status).toBe(404);
  });
  it("plan limits block growth; an administrator applies a requested plan", async () => {
    const { store: current } = (await store.agent.get("/api/workspace")).body;
    expect(current.plan).toBe("STARTER");
    await join("STAFF", "seat@tapcart.local"); // owner + 1 fills Starter's 2 seats
    const blocked = await send(store, "post", "/api/team/invites", { role: "STAFF", email: "" });
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe("PLAN_LIMIT");
    expect(
      (await send(store, "post", "/api/workspace/plan-request", { plan: "GROWTH" })).status,
    ).toBe(200);
    const notices = (await admin.agent.get("/api/notifications")).body;
    expect(notices.map((row: { id: string }) => row.id)).toContain("plans");
    expect(
      (await send(store, "post", `/api/stores/${current.id}/plan`, { plan: "SCALE" })).status,
    ).toBe(403);
    const applied = await send(admin, "post", `/api/stores/${current.id}/plan`, { plan: "GROWTH" });
    expect(applied.body).toMatchObject({ plan: "GROWTH", planRequested: null });
    expect(
      (await send(store, "post", "/api/team/invites", { role: "STAFF", email: "" })).status,
    ).toBe(201);
  });
  it("changing a password checks the old one and ends other sessions", async () => {
    const other = await login("store@tapcart.local");
    expect(
      (
        await send(store, "post", "/api/auth/password", {
          current: "wrong-password",
          next: "AnotherStrongPass1!",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(store, "post", "/api/auth/password", {
          current: "TapCartDemo123!",
          next: "AnotherStrongPass1!",
        })
      ).status,
    ).toBe(200);
    expect((await store.agent.get("/api/workspace")).status).toBe(200);
    expect((await other.agent.get("/api/workspace")).status).toBe(401);
    await login("store@tapcart.local", "AnotherStrongPass1!");
  });
  it("activity, unit history and analytics are scoped to the store", async () => {
    const unit = (await db.query("SELECT id FROM inventory_unit WHERE status='AVAILABLE' LIMIT 1"))
      .rows[0];
    const reserve = await shopper.agent
      .post("/api/reservations")
      .set("Origin", origin)
      .set("X-CSRF-Token", shopper.csrf)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ unitId: unit.id, version: 0 });
    expect(reserve.status).toBeLessThan(300);
    const activity = (await store.agent.get("/api/activity")).body;
    expect(activity.map((row: { eventType: string }) => row.eventType)).toContain(
      "InventoryReserved",
    );
    const history = (await store.agent.get(`/api/units/${unit.id}/history`)).body;
    expect(history.events[0].eventType).toBe("InventoryReserved");
    expect((await shopper.agent.get(`/api/units/${unit.id}/history`)).status).toBe(403);
    const week = (await store.agent.get("/api/analytics?days=7")).body;
    expect(week.dailySales).toHaveLength(7);
    expect(week.reservationOutcomes[0]).toMatchObject({ type: "InventoryReserved", count: 1 });
    expect((await store.agent.get("/api/analytics?days=8")).status).toBe(400);
    expect((await shopper.agent.get("/api/activity")).status).toBe(403);
    expect((await shopper.agent.get("/api/notifications")).status).toBe(403);
  });
  it("low-stock threshold drives the dashboard list", async () => {
    const { store: current } = (await store.agent.get("/api/workspace")).body;
    const update = await send(store, "patch", "/api/workspace", {
      name: current.name,
      address: current.address,
      phone: "+91 80 0000 0000",
      supportEmail: "help@example.com",
      lowStockThreshold: 0,
    });
    expect(update.status).toBe(200);
    const low = (await store.agent.get("/api/dashboard")).body.lowStock;
    expect(low.every((row: { available: number }) => row.available === 0)).toBe(true);
  });
});
