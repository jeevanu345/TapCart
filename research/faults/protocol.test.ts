import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { createDatabase, migrate, type Database } from "../../server/db.js";
import {
  reserve,
  release,
  checkout,
  recordPayment,
  returnUnit,
  expireReservations,
  idempotent,
} from "../../server/protocol.js";
import {
  calculateSdmMac,
  encryptTagKey,
  verifyTagForUnit,
} from "../../server/nfc/authenticated.js";
import type { Auth } from "../../server/types.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test"))
  throw new Error("TEST_DATABASE_URL must name an isolated test database.");
describe("Eleven independent PostgreSQL fault and model-trace scenarios", () => {
  const schema = `fault_${randomUUID().replaceAll("-", "")}`,
    root = createDatabase(databaseUrl!);
  let db: Database, auth: Auth, other: Auth, unitId: string, storeId: string;
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    db = createDatabase(url.toString());
    await migrate(db);
  });
  afterAll(async () => {
    if (db) await db.pool.end();
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.pool.end();
  });
  beforeEach(async () => {
    const owner = randomUUID(),
      user = randomUUID(),
      product = randomUUID();
    storeId = randomUUID();
    unitId = randomUUID();
    for (const [id, role] of [
      [owner, "STORE"],
      [user, "CUSTOMER"],
    ])
      await db.query(
        "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,'Fault fixture',$2,'unused',$3)",
        [id, `${id}@fixture.invalid`, role],
      );
    await db.query(
      "INSERT INTO store(id,owner_id,name,status) VALUES($1,$2,'Fault fixture','APPROVED')",
      [storeId, owner],
    );
    await db.query(
      "INSERT INTO product(id,store_id,sku,name,price_cents) VALUES($1,$2,$3,'Fault unit',100)",
      [product, storeId, product],
    );
    await db.query(
      "INSERT INTO inventory_unit(id,store_id,product_id,staff_code) VALUES($1,$2,$3,$4)",
      [unitId, storeId, product, unitId],
    );
    const sessions = [randomUUID(), randomUUID()];
    for (const id of sessions)
      await db.query(
        "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,'fixture',now()+interval '1 hour')",
        [id, user, id],
      );
    auth = {
      user: {
        id: user,
        name: "fixture",
        email: "fixture@invalid",
        role: "CUSTOMER",
        storeId: null,
      },
      sessionId: sessions[0]!,
      csrfToken: "fixture",
    };
    other = { ...auth, sessionId: sessions[1]! };
  });
  const row = async () =>
    (await db.query("SELECT * FROM inventory_unit WHERE id=$1", [unitId])).rows[0];
  const take = async (actor = auth) =>
    (await db.transaction((c) => reserve(c, actor, { unitId, version: 0 }))).body as {
      reservationId: string;
      version: number;
    };
  const prepare = async () => {
    const held = await take();
    return (
      await db.transaction((c) =>
        checkout(c, auth, { method: "DESK", items: [{ unitId, ...held }] }),
      )
    ).body as { id: string };
  };
  it("F1 replays a committed reservation after a lost response", async () => {
    const key = randomUUID(),
      input = { unitId, version: 0 };
    const call = () => idempotent(db, auth.sessionId, key, input, (c) => reserve(c, auth, input));
    const first = await call(),
      replay = await call();
    expect(replay.body).toEqual(first.body);
    expect(replay.replay).toBe(true);
    expect((await row()).version).toBe("1");
  });
  it("F2 serializes concurrent identical keys to one reservation event", async () => {
    const key = randomUUID(),
      input = { unitId, version: 0 };
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        idempotent(db, auth.sessionId, key, input, (c) => reserve(c, auth, input)),
      ),
    );
    expect(results.filter((x) => !x.replay)).toHaveLength(1);
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM outbox WHERE aggregate_id=$1 AND event_type='InventoryReserved'",
          [unitId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("F3 rejects a changed request behind the original idempotency key", async () => {
    const key = randomUUID();
    await idempotent(db, auth.sessionId, key, { unitId, version: 0 }, (c) =>
      reserve(c, auth, { unitId, version: 0 }),
    );
    await expect(
      idempotent(db, auth.sessionId, key, { unitId, version: 1 }, (c) =>
        reserve(c, auth, { unitId, version: 1 }),
      ),
    ).rejects.toThrow();
    expect((await row()).version).toBe("1");
  });
  it("F4 rolls back checkout protection and order on a process exception", async () => {
    const held = await take();
    await expect(
      db.transaction(async (c) => {
        await checkout(c, auth, { method: "DESK", items: [{ unitId, ...held }] });
        throw new Error("injected crash after protection");
      }),
    ).rejects.toThrow("injected");
    expect((await row()).checkout_order_id).toBeNull();
    expect(
      (await db.query("SELECT count(*)::int n FROM customer_order WHERE store_id=$1", [storeId]))
        .rows[0].n,
    ).toBe(0);
  });
  it("F5 rolls back callback/finalization interruption and safely retries", async () => {
    const order = await prepare();
    await expect(
      db.transaction(async (c) => {
        await recordPayment(c, order.id, "crash-event", "SUCCEEDED", "FAULT");
        throw new Error("injected crash before commit");
      }),
    ).rejects.toThrow();
    expect((await row()).status).toBe("RESERVED");
    expect(
      (await db.query("SELECT count(*)::int n FROM payment_event WHERE order_id=$1", [order.id]))
        .rows[0].n,
    ).toBe(0);
    await db.transaction((c) => recordPayment(c, order.id, "crash-event", "SUCCEEDED", "FAULT"));
    expect((await row()).status).toBe("SOLD");
  });
  it("F6 distinct duplicate settlement notifications produce one unit sale", async () => {
    const order = await prepare();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        db.transaction((c) => recordPayment(c, order.id, `settle-${i}`, "SUCCEEDED", "FAULT")),
      ),
    );
    expect(
      (await db.query("SELECT count(*)::int n FROM unit_sale WHERE unit_id=$1", [unitId])).rows[0]
        .n,
    ).toBe(1);
  });
  it("F7 replays the model rebinding counterexample and rejects the second active checkout", async () => {
    await prepare();
    const current = await row();
    await expect(
      db.transaction((c) =>
        checkout(c, auth, {
          method: "DESK",
          items: [
            { unitId, reservationId: current.reservation_id, version: Number(current.version) },
          ],
        }),
      ),
    ).rejects.toThrow();
    expect((await row()).checkout_order_id).toBe(current.checkout_order_id);
  });
  it("F8 competing expiry retries emit exactly one expiry event", async () => {
    await take();
    await db.query(
      "UPDATE inventory_unit SET reserved_until=now()-interval '1 second' WHERE id=$1",
      [unitId],
    );
    await Promise.all(Array.from({ length: 6 }, () => expireReservations(db)));
    expect((await row()).status).toBe("AVAILABLE");
    expect(
      (
        await db.query(
          "SELECT count(*)::int n FROM outbox WHERE aggregate_id=$1 AND event_type='ReservationExpired'",
          [unitId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("F9 replays the model owner-guard counterexample and rejects foreign release", async () => {
    const held = await take();
    await expect(
      db.transaction((c) => release(c, other, held.reservationId, held.version)),
    ).rejects.toThrow();
    expect((await row()).owner_session_id).toBe(auth.sessionId);
  });
  it("F10 return and resale use separate epochs despite an old payment replay", async () => {
    const order = await prepare();
    await db.transaction((c) => recordPayment(c, order.id, "first-sale", "SUCCEEDED", "FAULT"));
    let current = await row();
    await db.transaction((c) =>
      returnUnit(c, unitId, {
        orderId: order.id,
        version: Number(current.version),
        reason: "fault return",
      }),
    );
    current = await row();
    const held = (
      await db.transaction((c) => reserve(c, auth, { unitId, version: Number(current.version) }))
    ).body as { reservationId: string; version: number };
    const second = (
      await db.transaction((c) =>
        checkout(c, auth, { method: "DESK", items: [{ unitId, ...held }] }),
      )
    ).body as { id: string };
    await db.transaction((c) => recordPayment(c, order.id, "first-sale", "SUCCEEDED", "FAULT"));
    expect((await row()).checkout_order_id).toBe(second.id);
    await db.transaction((c) => recordPayment(c, second.id, "second-sale", "SUCCEEDED", "FAULT"));
    expect(
      (
        await db.query("SELECT sale_epoch FROM unit_sale WHERE unit_id=$1 ORDER BY sale_epoch", [
          unitId,
        ])
      ).rows.map((x) => x.sale_epoch),
    ).toEqual([0, 1]);
  });
  it("F11 atomic SDM counter CAS accepts one winner and rolls back failed inventory attempts", async () => {
    const master = randomBytes(32),
      key = randomBytes(16),
      uid = "04DE5F1EACC040",
      counter = "00003D";
    await db.query("UPDATE inventory_unit SET nfc_policy='NTAG424_SDM' WHERE id=$1", [unitId]);
    await db.query(
      "INSERT INTO nfc_tag(unit_id,store_id,uid,scheme,encrypted_key) VALUES($1,$2,$3,'NTAG424_SDM_AES_PLAIN_EMPTY_MAC',$4)",
      [unitId, storeId, uid, encryptTagKey(key, master, `${storeId}:${unitId}:${uid}`)],
    );
    const mac = (
        await calculateSdmMac(key, Buffer.from(uid, "hex"), Buffer.from(counter, "hex").reverse())
      ).toString("hex"),
      payload = { uid, counter, mac };
    await expect(
      db.transaction(async (c) => {
        await verifyTagForUnit(c, unitId, payload, master.toString("hex"));
        throw new Error("injected inventory failure");
      }),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT last_counter FROM nfc_tag WHERE unit_id=$1", [unitId])).rows[0]
        .last_counter,
    ).toBe(-1);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        db.transaction((c) => verifyTagForUnit(c, unitId, payload, master.toString("hex"))),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db.query("SELECT last_counter FROM nfc_tag WHERE unit_id=$1", [unitId])).rows[0]
        .last_counter,
    ).toBe(61);
  });
});
