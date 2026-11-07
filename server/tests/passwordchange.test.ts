import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createDatabase, migrate } from "../db.js";
import { createApp } from "../app.js";
import { hashPassword, tokenHash, verifyPassword } from "../auth.js";
import { beginMfaEnrollment } from "../security/service.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.toLowerCase().includes("test"))
  throw new Error("Set TEST_DATABASE_URL to an isolated test database.");
const origin = "http://localhost:5173",
  password = "PasswordChangeOriginal123!";
describe("password changes serialize credential authority", () => {
  const schema = `password_change_${randomBytes(10).toString("hex")}`;
  const scopedUrl = new URL(url!);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const bootstrap = createDatabase(url!),
    db = createDatabase(scopedUrl.toString());
  const app = createApp(db, { origin, production: false, developmentPayments: true });
  beforeAll(async () => {
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    await migrate(db);
  });
  afterAll(async () => {
    await db.pool.end();
    await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`);
    await bootstrap.pool.end();
  });
  async function fixture() {
    const id = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,'Password change',$2,$3,'CUSTOMER')",
      [id, `${id}@test.local`, await hashPassword(password)],
    );
    async function session() {
      const sessionId = randomUUID(),
        token = randomBytes(32).toString("base64url"),
        csrf = randomBytes(32).toString("base64url");
      await db.query(
        "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",
        [sessionId, id, tokenHash(token), csrf],
      );
      return { id: sessionId, cookie: `tapcart_session=${token}`, csrf };
    }
    return { id, session, current: await session() };
  }
  type Actor = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["session"]>>;
  function change(actor: Actor, next: string, current = password) {
    return request(app)
      .post("/api/auth/password")
      .set("Cookie", actor.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", actor.csrf)
      .send({ current, next });
  }
  it("keeps the current session, revokes others, and invalidates pending credential setup", async () => {
    const user = await fixture(),
      other = await user.session();
    await beginMfaEnrollment(db, user.id, password);
    await db.query(
      "INSERT INTO mfa_challenge(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')",
      [tokenHash(randomUUID()), user.id],
    );
    await db.query(
      "INSERT INTO account_token(id,user_id,purpose,token_hash,expires_at) VALUES($1,$2,'RESET_PASSWORD',$3,now()+interval '30 minutes')",
      [randomUUID(), user.id, tokenHash(randomUUID())],
    );
    expect((await change(user.current, "PasswordChangeUpdated123!")).status).toBe(200);
    const current = await request(app).get("/api/auth/session").set("Cookie", user.current.cookie),
      revoked = await request(app).get("/api/auth/session").set("Cookie", other.cookie);
    expect(current.body.user.id).toBe(user.id);
    expect(revoked.body.user).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM mfa_challenge WHERE user_id=$1 AND used_at IS NULL",
          [user.id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (await db.query("SELECT pending_ciphertext FROM account_mfa WHERE user_id=$1", [user.id]))
        .rows[0].pending_ciphertext,
    ).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM account_token WHERE user_id=$1 AND used_at IS NULL",
          [user.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("accepts only one simultaneous change authorized by the same old password", async () => {
    const user = await fixture();
    const results = await Promise.all([
      change(user.current, "FirstConcurrentChange123!"),
      change(user.current, "SecondConcurrentChange123!"),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
  });
  it("rejects an in-flight request after a reset revokes its already loaded session", async () => {
    const user = await fixture(),
      holder = await db.pool.connect(),
      resetPassword = "ResetWonTheRace123!",
      replacementHash = await hashPassword(resetPassword);
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query("BEGIN");
      const blocker = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      await holder.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [user.id]);
      pending = change(user.current, "StaleRequestMustNotWin123!").then((response) => response);
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const row = (
          await db.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
            [blocker],
          )
        ).rows[0];
        if (row.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await holder.query("UPDATE app_user SET password_hash=$2 WHERE id=$1", [
        user.id,
        replacementHash,
      ]);
      await holder.query("UPDATE session SET expires_at=clock_timestamp() WHERE user_id=$1", [
        user.id,
      ]);
      await holder.query("COMMIT");
      expect((await pending).status).toBe(401);
      const row = (await db.query("SELECT password_hash FROM app_user WHERE id=$1", [user.id]))
        .rows[0];
      expect(await verifyPassword(resetPassword, row.password_hash)).toBe(true);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      if (pending) await pending;
    }
  });
});
