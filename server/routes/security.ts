import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Database } from "../db.js";
import { json } from "../db.js";
import type { AppOptions } from "../types.js";
import { createSession, requireAuth, roles } from "../auth.js";
import { ApiError } from "../errors.js";
import {
  beginMfaEnrollment,
  completeMfaLogin,
  confirmMfaEnrollment,
  consumeAccountToken,
  disableMfa,
  enqueueVerification,
  requestPasswordReset,
  transactionDatabase,
} from "../security/service.js";
import { decryptSecret, securityKey } from "../security/crypto.js";
export function registerSecurityRoutes(app: Express, db: Database, options: AppOptions) {
  securityKey(options.production);
  const limited = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const token = z.string().min(32).max(100),
    password = z.string().min(12).max(128),
    code = z.string().min(6).max(32);
  const accepted = {
    ok: true,
    message: "If the account is eligible, an email will arrive shortly.",
  };
  app.post("/api/auth/password/forgot", limited, async (req, res) => {
    const { email } = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
      })
      .parse(req.body);
    await requestPasswordReset(db, email, options.origin);
    res.json(accepted);
  });
  app.post("/api/auth/password/reset", limited, async (req, res) => {
    const input = z.object({ token, password }).parse(req.body);
    await consumeAccountToken(db, input.token, input.password);
    res.json({ ok: true });
  });
  app.post("/api/auth/email/verification", limited, requireAuth, async (req, res) => {
    await enqueueVerification(db, req.auth!.user.id, options.origin);
    res.json(accepted);
  });
  app.post("/api/auth/email/verify", limited, async (req, res) => {
    const input = z.object({ token }).parse(req.body);
    await consumeAccountToken(db, input.token);
    res.json({ ok: true });
  });
  app.get("/api/auth/security", requireAuth, async (req, res) => {
    const row = (
      await db.query(
        `SELECT u.email_verified_at,m.enabled_at AS mfa_enabled_at,(SELECT count(*)::int FROM mfa_recovery_code c WHERE c.user_id=u.id AND c.used_at IS NULL) AS recovery_codes_remaining FROM app_user u LEFT JOIN account_mfa m ON m.user_id=u.id WHERE u.id=$1`,
        [req.auth!.user.id],
      )
    ).rows[0];
    res.json(json(row));
  });
  app.post("/api/auth/mfa/enroll", limited, requireAuth, async (req, res) => {
    const input = z.object({ password: z.string().max(128) }).parse(req.body);
    res.json(await beginMfaEnrollment(db, req.auth!.user.id, input.password));
  });
  app.post("/api/auth/mfa/confirm", limited, requireAuth, async (req, res) => {
    const input = z.object({ code }).parse(req.body);
    res.json(await confirmMfaEnrollment(db, req.auth!.user.id, input.code));
  });
  app.post("/api/auth/mfa/disable", limited, requireAuth, async (req, res) => {
    const input = z.object({ password: z.string().max(128), code }).parse(req.body);
    await disableMfa(db, req.auth!.user.id, input.password, input.code);
    res.json({ ok: true });
  });
  app.post("/api/auth/mfa/login", limited, async (req, res) => {
    const input = z.object({ challengeToken: token, code }).parse(req.body);
    let response: unknown;
    await completeMfaLogin(db, input.challengeToken, input.code, async (client, userId) => {
      const user = (
        await client.query(
          `SELECT u.id,u.name,u.email,u.role,s.id AS store_id,CASE WHEN s.owner_id=u.id THEN 'OWNER' ELSE m.role END AS store_role FROM app_user u LEFT JOIN store_member m ON m.user_id=u.id LEFT JOIN store s ON s.owner_id=u.id OR s.id=m.store_id WHERE u.id=$1`,
          [userId],
        )
      ).rows[0];
      const csrfToken = await createSession(
        transactionDatabase(db, client),
        userId,
        res,
        options.production,
      );
      response = {
        user: json(user),
        csrfToken,
        developmentPayments: options.developmentPayments && !options.production,
        cardPayments: Boolean(options.cardPayments),
      };
    });
    res.json(response);
  });
  app.get("/api/notifications/delivery", roles("ADMIN", "STORE"), async (req, res) => {
    const user = req.auth!.user;
    if (user.role === "STORE" && !["OWNER", "MANAGER"].includes(user.storeRole || ""))
      throw new ApiError(403, "A store manager is required.");
    const rows = (
      await db.query(
        `SELECT id,store_id,kind,subject,status,attempts,created_at,sent_at,last_error FROM notification_message WHERE ($1='ADMIN' OR store_id=$2) ORDER BY created_at DESC LIMIT 100`,
        [user.role, user.storeId],
      )
    ).rows;
    res.json({
      mode: process.env.EMAIL_MODE || (options.production ? "disabled" : "capture"),
      messages: json(rows),
    });
  });
  if (!options.production && (process.env.EMAIL_MODE || "capture") === "capture")
    app.get("/api/auth/security/captured-email", requireAuth, async (req, res) => {
      const rows = (
        await db.query(
          "SELECT id,subject,body_ciphertext,status,created_at FROM notification_message WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
          [req.auth!.user.id],
        )
      ).rows;
      res.json(
        rows.map(({ body_ciphertext, ...row }) => ({
          ...json(row),
          body: decryptSecret(body_ciphertext),
        })),
      );
    });
}
