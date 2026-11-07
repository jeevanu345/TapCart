import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import { generateSync } from "otplib";
import request from "supertest";
import { createDatabase, migrate } from "../db.js";
import { createApp } from "../app.js";
import { hashPassword, tokenHash, verifyPassword } from "../auth.js";
import {
  beginMfaEnrollment,
  completeMfaLogin,
  confirmMfaEnrollment,
  consumeAccountToken,
  createMfaLoginChallenge,
  disableMfa,
  enqueueVerification,
  requestPasswordReset,
} from "../security/service.js";
import { decryptSecret, encryptSecret, securityKey } from "../security/crypto.js";
import { enqueueEmail } from "../notifications/service.js";
import {
  deliverNotificationBatch,
  materializeNotificationEvents,
  notificationProvider,
} from "../notifications/worker.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.toLowerCase().includes("test"))
  throw new Error("Set TEST_DATABASE_URL to an isolated test database.");
const origin = "http://localhost:5173",
  password = "SecurityTestPassword123!";
describe("Account security and durable notification delivery", () => {
  const schema = `security_test_${randomBytes(10).toString("hex")}`;
  const scopedUrl = new URL(url!);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const bootstrap = createDatabase(url!);
  const db = createDatabase(scopedUrl.toString()),
    users: string[] = [],
    messages: string[] = [],
    events: string[] = [];
  const app = createApp(db, { origin, production: false, developmentPayments: true });
  async function user(role = "CUSTOMER") {
    const id = uuid(),
      email = `security-${id}@example.test`;
    await db.query(
      "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,'Security test',$2,$3,$4)",
      [id, email, await hashPassword(password), role],
    );
    users.push(id);
    return { id, email };
  }
  async function tokenFor(userId: string, kind: string) {
    const row = (
      await db.query(
        "SELECT body_ciphertext FROM notification_message WHERE user_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1",
        [userId, kind],
      )
    ).rows[0];
    return decryptSecret(row.body_ciphertext).match(/#token=([\w-]+)/)![1]!;
  }
  beforeAll(async () => {
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    await migrate(db);
  });
  afterAll(async () => {
    await db.pool.end();
    await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`);
    await bootstrap.pool.end();
  });
  it("encrypts secrets with authenticated encryption and rejects tampering", () => {
    const value = encryptSecret("a secret");
    expect(value).not.toContain("a secret");
    expect(decryptSecret(value)).toBe("a secret");
    const parts = value.split(".");
    parts[1] = randomBytes(16).toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
    if (!process.env.SECURITY_ENCRYPTION_KEY) expect(() => securityKey(true)).toThrow(/required/);
  });
  it("verifies email with a hashed, expiring token exactly once under concurrency", async () => {
    const u = await user();
    await enqueueVerification(db, u.id, origin);
    const token = await tokenFor(u.id, "VERIFY_EMAIL");
    expect(
      (await db.query("SELECT token_hash FROM account_token WHERE user_id=$1", [u.id])).rows[0]
        .token_hash,
    ).toBe(tokenHash(token));
    const results = await Promise.allSettled([
      consumeAccountToken(db, token),
      consumeAccountToken(db, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db.query("SELECT email_verified_at FROM app_user WHERE id=$1", [u.id])).rows[0]
        .email_verified_at,
    ).toBeTruthy();
  });
  it("resets a password once and revokes all sessions and preexisting MFA challenges", async () => {
    const u = await user();
    await db.query(
      "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,'csrf',now()+interval '1 hour')",
      [uuid(), u.id, tokenHash(uuid())],
    );
    const pendingSetup = await beginMfaEnrollment(db, u.id, password);
    await requestPasswordReset(db, u.email, origin);
    const token = await tokenFor(u.id, "RESET_PASSWORD"),
      next = "ChangedPassword123!";
    await consumeAccountToken(db, token, next);
    expect(
      (await db.query("SELECT pending_ciphertext FROM account_mfa WHERE user_id=$1", [u.id]))
        .rows[0].pending_ciphertext,
    ).toBeNull();
    await expect(
      confirmMfaEnrollment(db, u.id, generateSync({ secret: pendingSetup.secret })),
    ).rejects.toThrow(/expired/);
    expect(
      await verifyPassword(
        next,
        (await db.query("SELECT password_hash FROM app_user WHERE id=$1", [u.id])).rows[0]
          .password_hash,
      ),
    ).toBe(true);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM session WHERE user_id=$1 AND expires_at>now()",
          [u.id],
        )
      ).rows[0].count,
    ).toBe(0);
    await expect(consumeAccountToken(db, token, "AnotherPassword123!")).rejects.toThrow(
      /expired|already/,
    );
  });
  it("rejects expired recovery links without changing credentials", async () => {
    const u = await user();
    await requestPasswordReset(db, u.email, origin);
    const token = await tokenFor(u.id, "RESET_PASSWORD");
    await db.query(
      "UPDATE account_token SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [u.id],
    );
    await expect(consumeAccountToken(db, token, "ChangedPassword123!")).rejects.toThrow();
    expect(
      await verifyPassword(
        password,
        (await db.query("SELECT password_hash FROM app_user WHERE id=$1", [u.id])).rows[0]
          .password_hash,
      ),
    ).toBe(true);
  });
  it("requires the password and a valid setup code, and hashes one-use recovery codes", async () => {
    const u = await user("ADMIN");
    await expect(beginMfaEnrollment(db, u.id, "wrong")).rejects.toThrow(/Password/);
    const setup = await beginMfaEnrollment(db, u.id, password);
    await expect(confirmMfaEnrollment(db, u.id, "invalid")).rejects.toThrow();
    const { recoveryCodes } = await confirmMfaEnrollment(
      db,
      u.id,
      generateSync({ secret: setup.secret }),
    );
    expect(recoveryCodes).toHaveLength(10);
    const stored = (await db.query("SELECT * FROM account_mfa WHERE user_id=$1", [u.id])).rows[0];
    expect(stored.secret_ciphertext).not.toContain(setup.secret);
    expect(stored.pending_ciphertext).toBeNull();
    const challenge = await createMfaLoginChallenge(db, u.id);
    expect(challenge?.mfaRequired).toBe(true);
    const signedIn = await Promise.allSettled([
      completeMfaLogin(db, challenge!.challengeToken, recoveryCodes[0]!),
      completeMfaLogin(db, challenge!.challengeToken, recoveryCodes[0]!),
    ]);
    expect(signedIn.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const second = await createMfaLoginChallenge(db, u.id);
    await expect(completeMfaLogin(db, second!.challengeToken, recoveryCodes[0]!)).rejects.toThrow();
    expect(
      (
        await db.query("SELECT code_hash FROM mfa_recovery_code WHERE user_id=$1", [u.id])
      ).rows.every((r) => !recoveryCodes.includes(r.code_hash)),
    ).toBe(true);
    await disableMfa(db, u.id, password, recoveryCodes[1]!);
    expect(await createMfaLoginChallenge(db, u.id)).toBeNull();
  });
  it("limits challenge attempts, expires challenges, and prevents TOTP replay", async () => {
    const u = await user("STORE"),
      setup = await beginMfaEnrollment(db, u.id, password);
    await confirmMfaEnrollment(db, u.id, generateSync({ secret: setup.secret }));
    const challenge = await createMfaLoginChallenge(db, u.id);
    await expect(
      completeMfaLogin(db, challenge!.challengeToken, generateSync({ secret: setup.secret })),
    ).rejects.toThrow();
    for (let i = 1; i < 5; i++)
      await expect(completeMfaLogin(db, challenge!.challengeToken, "invalid")).rejects.toThrow();
    expect(
      (
        await db.query("SELECT attempts FROM mfa_challenge WHERE token_hash=$1", [
          tokenHash(challenge!.challengeToken),
        ])
      ).rows[0].attempts,
    ).toBe(5);
    await expect(completeMfaLogin(db, challenge!.challengeToken, "invalid")).rejects.toThrow();
    const next = await createMfaLoginChallenge(db, u.id);
    await db.query(
      "UPDATE mfa_challenge SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [tokenHash(next!.challengeToken)],
    );
    await expect(completeMfaLogin(db, next!.challengeToken, "invalid")).rejects.toThrow();
  });
  it("requires CSRF and returns indistinguishable forgot-password responses", async () => {
    const u = await user(),
      agent = request.agent(app),
      session = await agent.get("/api/auth/session");
    expect((await agent.post("/api/auth/password/forgot").send({ email: u.email })).status).toBe(
      403,
    );
    const known = await agent
      .post("/api/auth/password/forgot")
      .set("Origin", origin)
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ email: u.email });
    const unknown = await agent
      .post("/api/auth/password/forgot")
      .set("Origin", origin)
      .set("X-CSRF-Token", session.body.csrfToken)
      .send({ email: `unknown-${uuid()}@example.test` });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });
  it("deduplicates email, captures locally without sent status, retries real failures and claims once", async () => {
    const u = await user();
    const key = `test:${uuid()}`;
    messages.push(key);
    await enqueueEmail(db, {
      dedupeKey: key,
      userId: u.id,
      recipient: u.email,
      kind: "TEST",
      subject: "Test",
      body: "Private content",
    });
    await enqueueEmail(db, {
      dedupeKey: key,
      userId: u.id,
      recipient: u.email,
      kind: "TEST",
      subject: "Test",
      body: "Private content",
    });
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM notification_message WHERE dedupe_key=$1",
          [key],
        )
      ).rows[0].count,
    ).toBe(1);
    // Only this suite's messages are due: do not claim other suites' pending messages.
    await db.query(
      "UPDATE notification_message SET available_at=now()+interval '1 day' WHERE user_id=ANY($1::uuid[])",
      [users],
    );
    await db.query("UPDATE notification_message SET available_at=now() WHERE dedupe_key=$1", [key]);
    await deliverNotificationBatch(db, null);
    let row = (await db.query("SELECT * FROM notification_message WHERE dedupe_key=$1", [key]))
      .rows[0];
    expect(row.status).toBe("CAPTURED");
    expect(row.sent_at).toBeNull();
    await db.query("UPDATE notification_message SET status='PENDING' WHERE dedupe_key=$1", [key]);
    await deliverNotificationBatch(db, {
      send: async () => {
        throw new Error("provider credentials should never leak");
      },
    });
    row = (await db.query("SELECT * FROM notification_message WHERE dedupe_key=$1", [key])).rows[0];
    expect(row.status).toBe("RETRY");
    expect(row.sent_at).toBeNull();
    expect(row.last_error).not.toContain("credentials");
    await db.query("UPDATE notification_message SET available_at=now() WHERE dedupe_key=$1", [key]);
    let calls = 0;
    const provider = {
      send: async () => {
        calls++;
      },
    };
    await Promise.all([
      deliverNotificationBatch(db, provider),
      deliverNotificationBatch(db, provider),
    ]);
    expect(calls).toBe(1);
    expect(
      (await db.query("SELECT status FROM notification_message WHERE dedupe_key=$1", [key])).rows[0]
        .status,
    ).toBe("SENT");
  });
  it("requires MFA for admin, store and customer logins before setting a session cookie", async () => {
    for (const role of ["ADMIN", "STORE", "CUSTOMER"]) {
      const u = await user(role),
        setup = await beginMfaEnrollment(db, u.id, password);
      const { recoveryCodes } = await confirmMfaEnrollment(
        db,
        u.id,
        generateSync({ secret: setup.secret }),
      );
      const agent = request.agent(app),
        initial = await agent.get("/api/auth/session");
      const challenge = await agent
        .post("/api/auth/login")
        .set("Origin", origin)
        .set("X-CSRF-Token", initial.body.csrfToken)
        .send({ email: u.email, password });
      expect(challenge.status).toBe(200);
      expect(challenge.body.mfaRequired).toBe(true);
      expect(JSON.stringify(challenge.headers["set-cookie"] || [])).not.toContain(
        "tapcart_session",
      );
      expect((await agent.get("/api/auth/session")).body.user).toBeNull();
      const signedIn = await agent
        .post("/api/auth/mfa/login")
        .set("Origin", origin)
        .set("X-CSRF-Token", initial.body.csrfToken)
        .send({ challengeToken: challenge.body.challengeToken, code: recoveryCodes[0] });
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.user.id).toBe(u.id);
      expect(signedIn.body.user.role).toBe(role);
      expect((await agent.get("/api/auth/session")).body.user.id).toBe(u.id);
    }
  });
  it("materializes verified receipts, refunds and low-stock mail once from durable events", async () => {
    const customer = await user(),
      owner = await user("STORE"),
      storeId = uuid(),
      sessionId = uuid(),
      orderId = uuid(),
      productId = uuid(),
      unitId = uuid();
    await db.query("UPDATE app_user SET email_verified_at=now() WHERE id=ANY($1::uuid[])", [
      [customer.id, owner.id],
    ]);
    await db.query(
      "INSERT INTO store(id,owner_id,name,status,low_stock_threshold) VALUES($1,$2,'Security mail test','APPROVED',5)",
      [storeId, owner.id],
    );
    await db.query(
      "INSERT INTO session(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,'fixture',now()+interval '1 hour')",
      [sessionId, customer.id, tokenHash(uuid())],
    );
    await db.query(
      "INSERT INTO customer_order(id,user_id,owner_session_id,store_id,status,payment_method,total_cents) VALUES($1,$2,$3,$4,'COMPLETED','DESK',200)",
      [orderId, customer.id, sessionId, storeId],
    );
    await db.query(
      "INSERT INTO product(id,store_id,sku,name,price_cents) VALUES($1,$2,'MAILTEST','Mail test product',200)",
      [productId, storeId],
    );
    await db.query(
      "INSERT INTO inventory_unit(id,product_id,store_id,staff_code,status,sold_order_id,sold_at) VALUES($1,$2,$3,$4,'SOLD',$5,now())",
      [unitId, productId, storeId, uuid(), orderId],
    );
    await db.query(
      "INSERT INTO order_unit(order_id,unit_id,product_id,reservation_id,protected_version,sale_epoch,name,sku,price_cents) VALUES($1,$2,$3,$4,1,0,'Mail test product','MAILTEST',200)",
      [orderId, unitId, productId, uuid()],
    );
    for (const eventType of ["InventorySold", "RefundConfirmed"]) {
      const eventId = uuid();
      events.push(eventId);
      await db.query(
        "INSERT INTO outbox(id,event_type,aggregate_id,payload) VALUES($1,$2,$3,'{\"amountCents\":200}')",
        [eventId, eventType, orderId],
      );
      await db.query(
        "INSERT INTO event_delivery(event_id,event_type,aggregate_id,payload) SELECT id,event_type,aggregate_id,payload FROM outbox WHERE id=$1",
        [eventId],
      );
    }
    await Promise.all([
      materializeNotificationEvents(db, origin),
      materializeNotificationEvents(db, origin),
    ]);
    await materializeNotificationEvents(db, origin);
    const rows = (await db.query("SELECT * FROM notification_message WHERE store_id=$1", [storeId]))
      .rows;
    expect(rows.map((row) => row.kind).sort()).toEqual(["LOW_STOCK", "RECEIPT", "REFUND"]);
    expect(rows.every((row) => row.status === "PENDING")).toBe(true);
    expect(decryptSecret(rows.find((row) => row.kind === "REFUND")!.body_ciphertext)).toContain(
      "INR 2.00",
    );
  });
  it("queues operational anomaly owner email once and requires verified email", async () => {
    const owner = await user("STORE"),
      storeId = uuid();
    await db.query(
      "INSERT INTO store(id,owner_id,name,status) VALUES($1,$2,'Anomaly mail store','APPROVED')",
      [storeId, owner.id],
    );
    async function detect(title: string) {
      const eventId = uuid();
      events.push(eventId);
      await db.query(
        "INSERT INTO outbox(id,event_type,aggregate_id,payload) VALUES($1,'OperationalAnomalyDetected',$2,$3::jsonb)",
        [
          eventId,
          uuid(),
          JSON.stringify({
            storeId,
            title,
            kind: "STOCK_DISCREPANCY",
            severity: "HIGH",
            alertId: uuid(),
          }),
        ],
      );
      await db.query(
        "INSERT INTO event_delivery(event_id,event_type,aggregate_id,payload) SELECT id,event_type,aggregate_id,payload FROM outbox WHERE id=$1",
        [eventId],
      );
      await materializeNotificationEvents(db, origin);
    }
    await detect("Unverified owner alert");
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM notification_message WHERE store_id=$1",
          [storeId],
        )
      ).rows[0].count,
    ).toBe(0);
    await db.query("UPDATE app_user SET email_verified_at=now() WHERE id=$1", [owner.id]);
    await detect("Review the stock ledger");
    await materializeNotificationEvents(db, origin);
    const rows = (await db.query("SELECT * FROM notification_message WHERE store_id=$1", [storeId]))
      .rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("OPERATIONAL_ANOMALY");
    expect(rows[0].recipient).toBe(owner.email);
    expect(decryptSecret(rows[0].body_ciphertext)).toContain("Review the stock ledger");
  });
  it("scopes delivery status to a store's managers and excludes private mail content", async () => {
    const owner = await user("STORE"),
      other = await user("STORE"),
      staff = await user("STORE"),
      customer = await user(),
      admin = await user("ADMIN"),
      storeId = uuid(),
      otherStoreId = uuid();
    await db.query(
      "INSERT INTO store(id,owner_id,name,status) VALUES($1,$2,'Scoped mail store','APPROVED'),($3,$4,'Other mail store','APPROVED')",
      [storeId, owner.id, otherStoreId, other.id],
    );
    await db.query("INSERT INTO store_member(user_id,store_id,role) VALUES($1,$2,'STAFF')", [
      staff.id,
      storeId,
    ]);
    const key = `scope:${uuid()}`;
    messages.push(key);
    await enqueueEmail(db, {
      dedupeKey: key,
      userId: owner.id,
      storeId,
      recipient: owner.email,
      kind: "PRIVATE_SCOPE_TEST",
      subject: "Scoped delivery status",
      body: "Private mail body must not appear in status listings.",
    });
    async function login(email: string) {
      const agent = request.agent(app),
        initial = await agent.get("/api/auth/session");
      const result = await agent
        .post("/api/auth/login")
        .set("Origin", origin)
        .set("X-CSRF-Token", initial.body.csrfToken)
        .send({ email, password });
      expect(result.status).toBe(200);
      return agent;
    }
    const own = await (await login(owner.email)).get("/api/notifications/delivery");
    expect(own.status).toBe(200);
    expect(
      own.body.messages.some((row: { kind: string }) => row.kind === "PRIVATE_SCOPE_TEST"),
    ).toBe(true);
    expect(JSON.stringify(own.body)).not.toContain(owner.email);
    expect(JSON.stringify(own.body)).not.toContain("Private mail body");
    const scoped = await (await login(other.email)).get("/api/notifications/delivery");
    expect(scoped.status).toBe(200);
    expect(
      scoped.body.messages.some((row: { kind: string }) => row.kind === "PRIVATE_SCOPE_TEST"),
    ).toBe(false);
    expect((await (await login(staff.email)).get("/api/notifications/delivery")).status).toBe(403);
    expect((await (await login(customer.email)).get("/api/notifications/delivery")).status).toBe(
      403,
    );
    expect(
      (await (await login(admin.email)).get("/api/notifications/delivery")).body.messages.some(
        (row: { kind: string }) => row.kind === "PRIVATE_SCOPE_TEST",
      ),
    ).toBe(true);
  });
  it("delivers through real local SMTP and persists transient and final SMTP rejection states", async () => {
    const received: { recipients: string[]; body: string }[] = [];
    let rejection: number | null = null;
    const smtp = new SMTPServer({
      secure: false,
      authOptional: true,
      disabledCommands: ["AUTH", "STARTTLS"],
      logger: false,
      onData(stream, smtpSession, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.once("end", () => {
          if (rejection) {
            const error = Object.assign(new Error("Disposable SMTP server rejection"), {
              responseCode: rejection,
            });
            callback(error);
            return;
          }
          received.push({
            recipients: smtpSession.envelope.rcptTo.map((value) => value.address),
            body: Buffer.concat(chunks).toString("utf8"),
          });
          callback();
        });
        stream.once("error", callback);
      },
    });
    await new Promise<void>((resolve, reject) => {
      smtp.once("error", reject);
      smtp.listen(0, "127.0.0.1", resolve);
    });
    try {
      const port = (smtp.server.address() as AddressInfo).port;
      vi.stubEnv("EMAIL_MODE", "smtp");
      vi.stubEnv("SMTP_HOST", "127.0.0.1");
      vi.stubEnv("SMTP_PORT", String(port));
      vi.stubEnv("SMTP_FROM", "sender@example.test");
      vi.stubEnv("SMTP_USER", undefined);
      vi.stubEnv("SMTP_PASSWORD", undefined);
      const owner = await user(),
        key = `smtp:${uuid()}`;
      messages.push(key);
      // This suite owns the entire isolated schema, including all other queued fixtures.
      await db.query(
        "UPDATE notification_message SET available_at=now()+interval '1 day' WHERE status IN ('PENDING','RETRY')",
      );
      await enqueueEmail(db, {
        dedupeKey: key,
        userId: owner.id,
        recipient: owner.email,
        kind: "SMTP_TEST",
        subject: "Disposable SMTP integration",
        body: "Actual Nodemailer SMTP body captured locally.",
      });
      const provider = notificationProvider(false);
      expect(provider).not.toBeNull();
      await deliverNotificationBatch(db, provider, 1);
      expect(received).toHaveLength(1);
      expect(received[0].recipients).toEqual([owner.email]);
      expect(received[0].body).toContain("Actual Nodemailer SMTP body captured locally.");
      expect(received[0].body).toContain("Subject: Disposable SMTP integration");
      expect(received[0].body).toContain("From: sender@example.test");
      let message = (
        await db.query("SELECT * FROM notification_message WHERE dedupe_key=$1", [key])
      ).rows[0];
      expect(message.status).toBe("SENT");
      expect(message.sent_at).toBeTruthy();
      expect(received[0].body).toContain(`Message-ID: <${message.id}@tapcart.notification>`);
      rejection = 451;
      await db.query(
        "UPDATE notification_message SET status='PENDING',sent_at=NULL,attempts=0,available_at=now() WHERE dedupe_key=$1",
        [key],
      );
      await deliverNotificationBatch(db, provider, 1);
      message = (await db.query("SELECT * FROM notification_message WHERE dedupe_key=$1", [key]))
        .rows[0];
      expect(message.status).toBe("RETRY");
      expect(message.sent_at).toBeNull();
      expect(message.attempts).toBe(1);
      expect(message.available_at.getTime()).toBeGreaterThan(Date.now());
      expect(received).toHaveLength(1);
      rejection = 550;
      await db.query(
        "UPDATE notification_message SET attempts=5,available_at=now() WHERE dedupe_key=$1",
        [key],
      );
      await deliverNotificationBatch(db, provider, 1);
      message = (await db.query("SELECT * FROM notification_message WHERE dedupe_key=$1", [key]))
        .rows[0];
      expect(message.status).toBe("FAILED");
      expect(message.sent_at).toBeNull();
      expect(message.attempts).toBe(6);
      expect(received).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve) => smtp.close(resolve));
    }
  });
  it("durably records ignored outbox events once", async () => {
    const id = uuid();
    events.push(id);
    await db.query(
      "INSERT INTO outbox(id,event_type,aggregate_id,payload) VALUES($1,'SecurityTestEvent',$2,'{}')",
      [id, uuid()],
    );
    await db.query(
      "INSERT INTO event_delivery(event_id,event_type,aggregate_id,payload) SELECT id,event_type,aggregate_id,payload FROM outbox WHERE id=$1",
      [id],
    );
    await materializeNotificationEvents(db, origin);
    await materializeNotificationEvents(db, origin);
    expect(
      (
        await db.query("SELECT count(*)::int AS count FROM notification_event WHERE event_id=$1", [
          id,
        ])
      ).rows[0].count,
    ).toBe(1);
  });
  it("claims only the next delivery and never ages messages while they wait locally", async () => {
    await deliverNotificationBatch(db, null, 100);
    const u = await user();
    for (let i = 0; i < 2; i++)
      await enqueueEmail(db, {
        dedupeKey: `lease:${uuid()}`,
        userId: u.id,
        recipient: u.email,
        kind: "LEASE_TEST",
        subject: "Lease test",
        body: "Local delivery fixture",
      });
    let release!: () => void, started!: () => void;
    const paused = new Promise<void>((resolve) => {
        release = resolve;
      }),
      sending = new Promise<void>((resolve) => {
        started = resolve;
      });
    let calls = 0;
    const run = deliverNotificationBatch(
      db,
      {
        send: async () => {
          calls++;
          started();
          await paused;
        },
      },
      2,
    );
    try {
      await sending;
      const states = (
        await db.query(
          "SELECT status,count(*)::int n FROM notification_message WHERE user_id=$1 AND kind='LEASE_TEST' GROUP BY status",
          [u.id],
        )
      ).rows;
      expect(states.find((s) => s.status === "PROCESSING")?.n).toBe(1);
      expect(states.find((s) => s.status === "PENDING")?.n).toBe(1);
      await deliverNotificationBatch(db, null, 1);
    } finally {
      release();
      await run;
    }
    expect(calls).toBe(1);
    const final = (
      await db.query(
        "SELECT status FROM notification_message WHERE user_id=$1 AND kind='LEASE_TEST' ORDER BY status",
        [u.id],
      )
    ).rows.map((r) => r.status);
    expect(final).toEqual(["CAPTURED", "SENT"]);
  });
});
