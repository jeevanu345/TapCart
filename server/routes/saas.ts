import { createHash, randomBytes } from "node:crypto";
import type { Express, Request } from "express";
import rateLimit from "express-rate-limit";
import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { Database } from "../db.js";
import { json } from "../db.js";
import { ApiError } from "../errors.js";
import { createSession, hashPassword, requireAuth, roles, verifyPassword } from "../auth.js";
import { planById, type PlanId } from "../plans.js";
import { event, publicUnit, unitSelect } from "../protocol.js";
import type { AppOptions } from "../types.js";
import { authSchema, id, storeScope, text } from "./shared.js";

const plan = z.enum(["STARTER", "GROWTH", "SCALE"]);
const memberRole = z.enum(["MANAGER", "STAFF"]);
const inviteHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function usage(db: Database, storeId: string) {
  const row = (
    await db.query(
      `SELECT (SELECT count(*)::int FROM product WHERE store_id=$1 AND active) AS products,
       (SELECT count(*)::int FROM inventory_unit WHERE store_id=$1 AND status<>'SOLD') AS units,
       1+(SELECT count(*)::int FROM store_member WHERE store_id=$1) AS seats,
       (SELECT count(*)::int FROM store_invite WHERE store_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) AS invites,
       (SELECT plan FROM store WHERE id=$1) AS plan`,
      [storeId],
    )
  ).rows[0];
  return row as { products: number; units: number; seats: number; invites: number; plan: PlanId };
}
/** Rejects a growth action that would pass the store's plan limit. Existing data is never touched. */
export async function assertCapacity(
  db: Database,
  storeId: string,
  add: { products?: number; units?: number; seats?: number },
) {
  const current = await usage(db, storeId);
  const details = planById(current.plan);
  const over = (kind: "products" | "units" | "seats", label: string, used: number) => {
    const limit = details.limits[kind];
    if (add[kind] && limit !== null && used + add[kind] > limit)
      throw new ApiError(
        402,
        `The ${details.name} plan includes ${limit.toLocaleString("en-IN")} ${label}. You are using ${used.toLocaleString("en-IN")}. Request a larger plan in Settings.`,
        "PLAN_LIMIT",
      );
  };
  over("products", "active products", current.products);
  over("units", "unsold units", current.units);
  over("seats", "team seats", current.seats + current.invites);
}
function requireManager(req: Request) {
  const user = req.auth!.user;
  if (user.role !== "STORE" || !user.storeId)
    throw new ApiError(403, "A store account is required.");
  if (user.storeRole === "STAFF")
    throw new ApiError(403, "Ask a store manager or owner to make this change.");
  return user.storeId;
}
const activitySql = `SELECT o.id,o.event_type,o.aggregate_id,o.created_at,o.payload,
  COALESCE(un.staff_code,'') AS unit_code,COALESCE(p.name,pr.name,'') AS product_name,co.total_cents,
  COALESCE(un.store_id,co.store_id,pr.store_id,st.id) AS store_id
  FROM outbox o
  LEFT JOIN inventory_unit un ON un.id=o.aggregate_id
  LEFT JOIN product p ON p.id=un.product_id
  LEFT JOIN customer_order co ON co.id=o.aggregate_id
  LEFT JOIN product pr ON pr.id=o.aggregate_id
  LEFT JOIN store st ON st.id=o.aggregate_id`;

export function registerSaasRoutes(app: Express, db: Database, options: AppOptions) {
  const limited = rateLimit({
    windowMs: 15 * 60_000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.patch("/api/auth/profile", requireAuth, async (req, res) => {
    const input = z.object({ name: text }).parse(req.body);
    await db.query("UPDATE app_user SET name=$2 WHERE id=$1", [req.auth!.user.id, input.name]);
    res.json({ ok: true, name: input.name });
  });
  app.post("/api/auth/password", requireAuth, limited, async (req, res) => {
    const input = z
      .object({ current: z.string().min(1).max(128), next: z.string().min(12).max(128) })
      .parse(req.body);
    const row = (
      await db.query("SELECT password_hash FROM app_user WHERE id=$1", [req.auth!.user.id])
    ).rows[0];
    if (!(await verifyPassword(input.current, row.password_hash)))
      throw new ApiError(400, "Your current password is incorrect.");
    await db.transaction(async (client) => {
      await client.query("UPDATE app_user SET password_hash=$2 WHERE id=$1", [
        req.auth!.user.id,
        await hashPassword(input.next),
      ]);
      await client.query(
        "UPDATE session SET expires_at=now() WHERE user_id=$1 AND id<>$2 AND expires_at>now()",
        [req.auth!.user.id, req.auth!.sessionId],
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/workspace", roles("STORE"), async (req, res) => {
    const storeId = req.auth!.user.storeId!;
    const store = (await db.query("SELECT * FROM store WHERE id=$1", [storeId])).rows[0];
    res.json({ store: json(store), usage: await usage(db, storeId) });
  });
  app.patch("/api/workspace", roles("STORE"), async (req, res) => {
    const storeId = requireManager(req);
    const input = z
      .object({
        name: text,
        address: z.string().trim().max(500),
        phone: z.string().trim().max(40),
        supportEmail: z.union([z.literal(""), z.string().trim().email().max(254)]),
        lowStockThreshold: z.number().int().min(0).max(1000),
      })
      .parse(req.body);
    const row = await db.transaction(async (client) => {
      const updated = (
        await client.query(
          "UPDATE store SET name=$2,address=$3,phone=$4,support_email=$5,low_stock_threshold=$6 WHERE id=$1 RETURNING *",
          [
            storeId,
            input.name,
            input.address,
            input.phone,
            input.supportEmail,
            input.lowStockThreshold,
          ],
        )
      ).rows[0];
      await event(client, "WorkspaceUpdated", storeId, { by: req.auth!.user.name });
      return updated;
    });
    res.json(json(row));
  });
  app.post("/api/workspace/plan-request", roles("STORE"), async (req, res) => {
    const storeId = requireManager(req);
    const input = z.object({ plan: plan.nullable() }).parse(req.body);
    await db.transaction(async (client) => {
      await client.query("UPDATE store SET plan_requested=$2 WHERE id=$1", [storeId, input.plan]);
      await event(client, "PlanRequested", storeId, { plan: input.plan, by: req.auth!.user.name });
    });
    res.json({ ok: true, planRequested: input.plan });
  });
  app.post("/api/stores/:id/plan", roles("ADMIN"), async (req, res) => {
    const storeId = id(req),
      input = z.object({ plan }).parse(req.body);
    const row = await db.transaction(async (client) => {
      const updated = (
        await client.query("UPDATE store SET plan=$2,plan_requested=NULL WHERE id=$1 RETURNING *", [
          storeId,
          input.plan,
        ])
      ).rows[0];
      if (!updated) throw new ApiError(404, "Store not found.");
      await event(client, "PlanChanged", storeId, { plan: input.plan });
      return updated;
    });
    res.json(json(row));
  });
  app.get("/api/team", roles("STORE"), async (req, res) => {
    const storeId = req.auth!.user.storeId!;
    const [members, invites] = await Promise.all([
      db.query(
        `SELECT u.id,u.name,u.email,'OWNER' AS role,s.created_at FROM store s JOIN app_user u ON u.id=s.owner_id WHERE s.id=$1
         UNION ALL SELECT u.id,u.name,u.email,m.role,m.created_at FROM store_member m JOIN app_user u ON u.id=m.user_id WHERE m.store_id=$1 ORDER BY created_at`,
        [storeId],
      ),
      db.query(
        "SELECT id,role,email,expires_at,created_at FROM store_invite WHERE store_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC",
        [storeId],
      ),
    ]);
    res.json({ members: json(members.rows), invites: json(invites.rows) });
  });
  app.post("/api/team/invites", roles("STORE"), async (req, res) => {
    const storeId = requireManager(req);
    const input = z
      .object({
        role: memberRole,
        email: z.union([
          z.literal(""),
          z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((value) => value.toLowerCase()),
        ]),
      })
      .parse(req.body);
    await assertCapacity(db, storeId, { seats: 1 });
    const token = randomBytes(32).toString("base64url"),
      inviteId = uuid();
    await db.transaction(async (client) => {
      await client.query(
        "INSERT INTO store_invite(id,store_id,token_hash,role,email,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days')",
        [inviteId, storeId, inviteHash(token), input.role, input.email, req.auth!.user.id],
      );
      await event(client, "TeamInviteCreated", storeId, {
        role: input.role,
        by: req.auth!.user.name,
      });
    });
    // The raw token exists only in this response; only its hash is stored.
    res.status(201).json({ id: inviteId, token, role: input.role, email: input.email });
  });
  app.delete("/api/team/invites/:id", roles("STORE"), async (req, res) => {
    const storeId = requireManager(req);
    const result = await db.query(
      "UPDATE store_invite SET revoked_at=now() WHERE id=$1 AND store_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL",
      [id(req), storeId],
    );
    if (!result.rowCount) throw new ApiError(404, "Invitation not found.");
    res.json({ ok: true });
  });
  app.delete("/api/team/members/:id", roles("STORE"), async (req, res) => {
    const storeId = requireManager(req),
      userId = id(req);
    await db.transaction(async (client) => {
      const removed = await client.query(
        "DELETE FROM store_member WHERE user_id=$1 AND store_id=$2",
        [userId, storeId],
      );
      if (!removed.rowCount) throw new ApiError(404, "This person is not a removable team member.");
      // The person keeps their account and order history as a shopper, without store access.
      await client.query("UPDATE app_user SET role='CUSTOMER' WHERE id=$1", [userId]);
      await event(client, "TeamMemberRemoved", storeId, { by: req.auth!.user.name });
    });
    res.json({ ok: true });
  });
  const invitation = async (token: string) =>
    (
      await db.query(
        "SELECT i.id,i.role,i.email,i.store_id,s.name AS store_name FROM store_invite i JOIN store s ON s.id=i.store_id WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND s.status='APPROVED'",
        [inviteHash(token)],
      )
    ).rows[0];
  const tokenValue = z.string().min(20).max(100);
  app.get("/api/invites/:token", limited, async (req, res) => {
    const row = await invitation(tokenValue.parse(req.params.token));
    if (!row) throw new ApiError(404, "This invitation has expired or was already used.");
    res.json({ storeName: row.store_name, role: row.role, email: row.email });
  });
  app.post("/api/invites/:token/accept", limited, async (req, res) => {
    const token = tokenValue.parse(req.params.token);
    const input = authSchema
      .extend({ name: text, password: z.string().min(12).max(128) })
      .parse(req.body);
    const password = await hashPassword(input.password),
      userId = uuid();
    const accepted = await db.transaction(async (client) => {
      // Conditional update: one accept can win, even when a link is opened twice at once.
      const row = (
        await client.query(
          "UPDATE store_invite SET accepted_at=now() WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING store_id,role,email",
          [inviteHash(token)],
        )
      ).rows[0];
      if (!row) throw new ApiError(404, "This invitation has expired or was already used.");
      if (row.email && row.email !== input.email)
        throw new ApiError(400, "Use the email address this invitation was sent to.");
      await client.query(
        "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'STORE')",
        [userId, input.name, input.email, password],
      );
      await client.query("INSERT INTO store_member(user_id,store_id,role) VALUES($1,$2,$3)", [
        userId,
        row.store_id,
        row.role,
      ]);
      await event(client, "TeamMemberJoined", row.store_id, { name: input.name, role: row.role });
      return row;
    });
    const csrfToken = await createSession(db, userId, res, options.production);
    res.status(201).json({
      user: {
        id: userId,
        name: input.name,
        email: input.email,
        role: "STORE",
        storeId: accepted.store_id,
        storeRole: accepted.role,
      },
      csrfToken,
    });
  });
  app.get("/api/activity", roles("ADMIN", "STORE"), async (req, res) => {
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(60)
      .parse(req.query.limit ?? 60);
    const rows = (
      await db.query(
        `SELECT * FROM (${activitySql}) a WHERE ($1::uuid IS NULL OR a.store_id=$1) ORDER BY a.created_at DESC,a.id DESC LIMIT $2`,
        [storeScope(req), limit],
      )
    ).rows;
    res.json(json(rows));
  });
  app.get("/api/units/:id/history", roles("ADMIN", "STORE"), async (req, res) => {
    const unitId = id(req);
    const row = (await db.query(`${unitSelect} WHERE u.id=$1`, [unitId])).rows[0];
    const scope = storeScope(req);
    if (!row || (scope && row.store_id !== scope)) throw new ApiError(404, "Unit not found.");
    const events = await db.query(
      `SELECT o.id,o.event_type,o.created_at,o.payload FROM outbox o
       WHERE o.aggregate_id=$1 OR o.aggregate_id IN (SELECT order_id FROM order_unit WHERE unit_id=$1)
       ORDER BY o.created_at DESC,o.id DESC LIMIT 100`,
      [unitId],
    );
    res.json({
      unit: publicUnit(row, req.auth),
      createdAt: row.created_at,
      events: json(events.rows),
    });
  });
  app.get("/api/notifications", roles("ADMIN", "STORE"), async (req, res) => {
    const scope = storeScope(req);
    const items: { id: string; title: string; detail: string; href: string }[] = [];
    if (scope) {
      const row = (
        await db.query(
          `SELECT (SELECT count(*)::int FROM customer_order WHERE store_id=$1 AND status='PAYMENT_PENDING') AS pending,
           (SELECT count(*)::int FROM customer_order WHERE store_id=$1 AND status='REFUND_PENDING') AS refunds,
           (SELECT count(*)::int FROM (SELECT p.id FROM product p JOIN store s ON s.id=p.store_id LEFT JOIN inventory_unit u ON u.product_id=p.id AND u.status='AVAILABLE' WHERE p.store_id=$1 AND p.active GROUP BY p.id,s.low_stock_threshold HAVING count(u.id)<=s.low_stock_threshold) low) AS low`,
          [scope],
        )
      ).rows[0];
      if (row.pending)
        items.push({
          id: "pending",
          title: `${row.pending} waiting at the desk`,
          detail: "Orders need payment confirmed.",
          href: "/store/desk",
        });
      if (row.refunds)
        items.push({
          id: "refunds",
          title: `${row.refunds} refund${row.refunds === 1 ? "" : "s"} to settle`,
          detail: "Returned units are waiting on a refund.",
          href: "/store/orders?status=REFUND_PENDING",
        });
      if (row.low)
        items.push({
          id: "low",
          title: `${row.low} product${row.low === 1 ? "" : "s"} running low`,
          detail: "At or below your low-stock threshold.",
          href: "/store/inventory?stock=low",
        });
      const current = await usage(db, scope);
      const limit = planById(current.plan).limits.units;
      if (limit !== null && current.units >= limit * 0.8)
        items.push({
          id: "plan",
          title: "Nearing your plan's unit limit",
          detail: `${current.units.toLocaleString("en-IN")} of ${limit.toLocaleString("en-IN")} unsold units in use.`,
          href: "/store/settings?tab=plan",
        });
    } else {
      const row = (
        await db.query(
          "SELECT count(*) FILTER(WHERE status='PENDING')::int AS pending,count(*) FILTER(WHERE plan_requested IS NOT NULL)::int AS plans FROM store",
        )
      ).rows[0];
      if (row.pending)
        items.push({
          id: "stores",
          title: `${row.pending} store${row.pending === 1 ? "" : "s"} awaiting approval`,
          detail: "Review new registrations.",
          href: "/admin",
        });
      if (row.plans)
        items.push({
          id: "plans",
          title: `${row.plans} plan request${row.plans === 1 ? "" : "s"}`,
          detail: "Stores asked to change plan.",
          href: "/admin",
        });
    }
    res.json(items);
  });
}
