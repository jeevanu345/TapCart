import { beforeAll, afterAll, describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createDatabase, migrate, type Database } from "../db.js";
import { registerNfcRoutes } from "../routes/nfc.js";
import type { Auth } from "../types.js";
import { enforceTagPolicy } from "../nfc/authenticated.js";
import { ApiError } from "../errors.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.toLowerCase().includes("test"))
  throw new Error("TEST_DATABASE_URL must name an isolated test database.");
describe("authenticated tag configuration API permissions and metadata (real PostgreSQL)", () => {
  const root = createDatabase(databaseUrl!),
    schema = `nfc_${randomUUID().replaceAll("-", "")}`,
    storeId = randomUUID(),
    unitId = randomUUID(),
    ownerId = randomUUID(),
    sessionId = randomUUID(),
    productId = randomUUID();
  let db: Database;
  let actor: Auth;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = actor;
    next();
  });
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    db = createDatabase(url.toString());
    await migrate(db);
    await db.query(
      "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,'NFC owner',$2,'unused','STORE')",
      [ownerId, `${ownerId}@fixture.invalid`],
    );
    await db.query(
      "INSERT INTO store(id,owner_id,name,status) VALUES($1,$2,'NFC fixture','APPROVED')",
      [storeId, ownerId],
    );
    await db.query(
      "INSERT INTO product(id,store_id,sku,name,price_cents) VALUES($1,$2,'NFC','Fixture',1)",
      [productId, storeId],
    );
    await db.query(
      "INSERT INTO inventory_unit(id,product_id,store_id,staff_code) VALUES($1,$2,$3,'NFC fixture')",
      [unitId, productId, storeId],
    );
    actor = {
      user: {
        id: ownerId,
        name: "owner",
        email: "owner@fixture.invalid",
        role: "STORE",
        storeId,
        storeRole: "OWNER",
      },
      sessionId,
      csrfToken: "unused",
    };
    registerNfcRoutes(app, db, { origin: "https://store.example", nfcMasterKey: "11".repeat(32) });
    app.use(
      (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
        res
          .status(error instanceof ApiError ? error.status : 500)
          .json({ error: error instanceof Error ? error.message : "Error" }),
    );
  });
  afterAll(async () => {
    if (db) await db.pool.end();
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.pool.end();
  });
  it("allows scoped staff metadata but rejects key enrollment before parsing its body", async () => {
    actor.user.storeRole = "STAFF";
    const metadata = await request(app).get(`/api/nfc/tags/${unitId}`);
    expect(metadata.status).toBe(200);
    expect(metadata.body.canConfigure).toBe(false);
    expect(metadata.body.registration).toBeNull();
    const result = await request(app).post("/api/nfc/tags").send({});
    expect(result.status).toBe(403);
    expect(
      (await db.query("SELECT nfc_policy FROM inventory_unit WHERE id=$1", [unitId])).rows[0]
        .nfc_policy,
    ).toBe("STATIC");
  });
  it("allows a manager to register and returns only safe metadata with no encrypted or raw key", async () => {
    actor.user.storeRole = "MANAGER";
    const key = "22".repeat(16),
      uid = "04DE5F1EACC040";
    const result = await request(app).post("/api/nfc/tags").send({
      unitId,
      uid,
      sdmFileReadKey: key,
      profile: "NTAG424_SDM_AES_PLAIN_EMPTY_MAC",
      hardwarePersonalizationConfirmed: true,
    });
    expect(result.status).toBe(201);
    expect(JSON.stringify(result.body)).not.toContain(key);
    const metadata = await request(app).get(`/api/nfc/tags/${unitId}`);
    expect(metadata.body.canConfigure).toBe(true);
    expect(metadata.body.registration).toMatchObject({ uid, lastCounter: -1 });
    expect(metadata.body.registration.encryptedKey).toBeUndefined();
    expect(JSON.stringify(metadata.body)).not.toContain(key);
    expect(
      (await db.query("SELECT encrypted_key FROM nfc_tag WHERE unit_id=$1", [unitId])).rows[0]
        .encrypted_key,
    ).not.toContain(key);
  });
  it("does not disclose metadata across tenant boundaries", async () => {
    actor.user.storeId = randomUUID();
    const result = await request(app).get(`/api/nfc/tags/${unitId}`);
    expect(result.status).toBe(404);
    actor.user.storeId = storeId;
  });
  it("waits for a concurrent policy enrollment and then requires its proof", async () => {
    const freshUnit = randomUUID();
    await db.query(
      "INSERT INTO inventory_unit(id,product_id,store_id,staff_code) VALUES($1,$2,$3,$4)",
      [freshUnit, productId, storeId, freshUnit],
    );
    const holder = await db.pool.connect();
    let pending: Promise<{ error?: unknown }> | undefined;
    try {
      await holder.query("BEGIN");
      const pid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await holder.query("UPDATE inventory_unit SET nfc_policy='NTAG424_SDM' WHERE id=$1", [
        freshUnit,
      ]);
      pending = db
        .transaction((client) => enforceTagPolicy(client, freshUnit))
        .then(
          () => ({}),
          (error) => ({ error }),
        );
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        blocked = (
          await db.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
            [pid],
          )
        ).rows[0].blocked;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await holder.query("COMMIT");
      expect((await pending).error).toMatchObject({ status: 403 });
      expect(
        (await db.query("SELECT status FROM inventory_unit WHERE id=$1", [freshUnit])).rows[0]
          .status,
      ).toBe("AVAILABLE");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      if (pending) await pending;
    }
  });
});
