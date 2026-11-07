import type { Express } from "express";
import type { Database } from "../db.js";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { v7 as uuid } from "uuid";
import { json } from "../db.js";
import type { AppOptions } from "../types.js";
import { ApiError } from "../errors.js";
import {
  createSession,
  hashPassword,
  requireAuth,
  roles,
  sessionCookie,
  cookieOptions,
  tokenHash,
  verifyPassword,
} from "../auth.js";
import { authSchema, text, id } from "./shared.js";
import {
  createMfaLoginChallenge,
  enqueueVerification,
  transactionDatabase,
} from "../security/service.js";
export function registerIdentityRoutes(app: Express, db: Database, options: AppOptions) {
  app.get("/api/auth/session", (req, res) =>
    res.json({
      user: req.auth?.user || null,
      csrfToken: req.csrfToken,
      developmentPayments: options.developmentPayments && !options.production,
      cardPayments: Boolean(options.cardPayments),
    }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const input = authSchema.parse(req.body);
    const result = await db.transaction(async (client) => {
      const row = (
        await client.query("SELECT * FROM app_user WHERE email=$1 FOR UPDATE", [input.email])
      ).rows[0];
      if (!row || !(await verifyPassword(input.password, row.password_hash)))
        throw new ApiError(401, "Email or password is incorrect.");
      const connection = transactionDatabase(db, client);
      const challenge = await createMfaLoginChallenge(connection, row.id);
      if (challenge) return { row, challenge, csrfToken: "" };
      if (req.cookies[sessionCookie])
        await client.query(
          "DELETE FROM session WHERE token_hash=$1 AND NOT EXISTS(SELECT 1 FROM inventory_unit WHERE owner_session_id=session.id) AND NOT EXISTS(SELECT 1 FROM customer_order WHERE owner_session_id=session.id)",
          [tokenHash(req.cookies[sessionCookie])],
        );
      const csrfToken = await createSession(connection, row.id, res, options.production);
      return { row, challenge: null, csrfToken };
    });
    if (result.challenge) {
      res.json(result.challenge);
      return;
    }
    const { row, csrfToken } = result;
    const store = (
      await db.query(
        "SELECT s.id,CASE WHEN s.owner_id=$1 THEN 'OWNER' ELSE m.role END AS store_role FROM store s LEFT JOIN store_member m ON m.store_id=s.id AND m.user_id=$1 WHERE s.owner_id=$1 OR m.user_id=$1",
        [row.id],
      )
    ).rows[0];
    res.json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        storeId: store?.id || null,
        storeRole: store?.store_role || null,
      },
      csrfToken,
      developmentPayments: options.developmentPayments && !options.production,
      cardPayments: Boolean(options.cardPayments),
    });
  });
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const input = authSchema
      .extend({
        name: text,
        password: z.string().min(12).max(128),
        role: z.enum(["CUSTOMER", "STORE"]).default("CUSTOMER"),
        storeName: text.optional(),
        address: z.string().max(500).optional(),
      })
      .parse(req.body);
    if (input.role === "STORE" && !input.storeName)
      throw new ApiError(400, "A store name is required.");
    const userId = uuid(),
      storeId = input.role === "STORE" ? uuid() : null,
      password = await hashPassword(input.password);
    await db.transaction(async (client) => {
      await client.query(
        "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [userId, input.name, input.email, password, input.role],
      );
      if (storeId)
        await client.query(
          "INSERT INTO store(id,owner_id,name,address,status) VALUES($1,$2,$3,$4,'PENDING')",
          [storeId, userId, input.storeName, input.address || ""],
        );
      await enqueueVerification(transactionDatabase(db, client), userId, options.origin);
    });
    const csrfToken = await createSession(db, userId, res, options.production);
    res.status(201).json({
      user: {
        id: userId,
        name: input.name,
        email: input.email,
        role: input.role,
        storeId,
        storeRole: storeId ? "OWNER" : null,
      },
      csrfToken,
      developmentPayments: options.developmentPayments && !options.production,
      cardPayments: Boolean(options.cardPayments),
    });
  });
  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    // Expire the session without deleting reservation/order history referenced by foreign keys.
    await db.query("UPDATE session SET expires_at=now() WHERE id=$1", [req.auth!.sessionId]);
    res.clearCookie(sessionCookie, { ...cookieOptions(options.production), maxAge: undefined });
    res.json({ ok: true });
  });
  app.get("/api/stores", async (req, res) => {
    const admin = req.auth?.user.role === "ADMIN";
    const fields = admin
      ? "s.*,u.name AS owner_name,u.email"
      : "s.id,s.name,s.address,s.status,s.created_at";
    res.json(
      json(
        (
          await db.query(
            `SELECT ${fields} FROM store s JOIN app_user u ON u.id=s.owner_id ${admin ? "" : "WHERE s.status='APPROVED' OR s.owner_id=$1 OR s.id=$2"} ORDER BY s.created_at DESC`,
            admin ? [] : [req.auth?.user.id || null, req.auth?.user.storeId || null],
          )
        ).rows,
      ),
    );
  });
  app.post("/api/stores/:id/approval", roles("ADMIN"), async (req, res) => {
    const { approved } = z.object({ approved: z.boolean() }).parse(req.body),
      storeId = id(req);
    const row = (
      await db.query(
        "UPDATE store SET status=$2,approved_at=CASE WHEN $2='APPROVED' THEN now() ELSE NULL END WHERE id=$1 RETURNING *",
        [storeId, approved ? "APPROVED" : "DENIED"],
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "Store not found.");
    res.json(json(row));
  });
  app.get("/api/users", roles("ADMIN"), async (_req, res) =>
    res.json(
      json(
        (
          await db.query(
            `SELECT u.id,u.name,u.email,u.role,u.created_at,s.id AS store_id,s.name AS store_name,s.status FROM app_user u LEFT JOIN store_member m ON m.user_id=u.id LEFT JOIN store s ON s.owner_id=u.id OR s.id=m.store_id ORDER BY u.created_at DESC`,
          )
        ).rows,
      ),
    ),
  );
}
