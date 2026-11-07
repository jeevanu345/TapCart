import type { Express, Request } from "express";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import type { Database } from "../db.js";
import { json } from "../db.js";
import type { AppOptions } from "../types.js";
import { requireStore, roles } from "../auth.js";
import { ApiError } from "../errors.js";
import { event, idempotent, unitSelect } from "../protocol.js";
import { createStripePayment } from "../stripe.js";
import { createStripeRefund } from "../refunds.js";
import { id, toResult, uuidValue } from "./shared.js";
import { claimPricing, preparePricing } from "../commerce/pricing.js";
import {
  createPurchase,
  getPurchase,
  purchaseSchema,
  receiptSchema,
  receivePurchase,
  validatePurchase,
} from "../commerce/purchasing.js";

// Re-export pricing so integrations have one stable module entry point.
export { preparePricing, claimPricing };
const supplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.union([z.literal(""), z.string().email().max(254)]).default(""),
    phone: z.string().max(80).default(""),
    address: z.string().max(1000).default(""),
    notes: z.string().max(3000).default(""),
    leadTimeDays: z.number().int().min(0).max(365).default(7),
    active: z.boolean().default(true),
  })
  .strict();
const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((code) => code.toUpperCase()),
    type: z.enum(["PERCENT", "FIXED"]),
    value: z.number().int().min(1).max(100_000_000),
    minimumSpendCents: z.number().int().min(0).max(2_147_483_647).default(0),
    startsAt: z.string().datetime().nullable().default(null),
    expiresAt: z.string().datetime().nullable().default(null),
    maxUses: z.number().int().min(1).max(10_000_000).nullable().default(null),
    perCustomerLimit: z.number().int().min(1).max(100000).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((c) => c.type !== "PERCENT" || c.value <= 100, "Percentage must not exceed 100.")
  .refine(
    (c) => !c.startsAt || !c.expiresAt || new Date(c.startsAt) < new Date(c.expiresAt),
    "Expiry must follow start.",
  );
async function scope(db: Database, req: Request, manage = false) {
  if (
    manage &&
    req.auth!.user.role !== "ADMIN" &&
    !["OWNER", "MANAGER"].includes(req.auth!.user.storeRole || "")
  )
    throw new ApiError(403, "An owner or manager must approve this action.");
  const requested =
    req.query.storeId === undefined ? undefined : uuidValue.parse(req.query.storeId);
  return requireStore(db, req.auth!.user, requested);
}
export function registerCommerceRoutes(app: Express, db: Database, options: AppOptions) {
  app.get("/api/suppliers", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req);
    res.json(
      json(
        (await db.query("SELECT * FROM supplier WHERE store_id=$1 ORDER BY name,id", [storeId]))
          .rows,
      ),
    );
  });
  app.post("/api/suppliers", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      input = supplierSchema.parse(req.body);
    toResult(
      res,
      await idempotent(
        db,
        `supplier:${storeId}`,
        req.get("Idempotency-Key"),
        input,
        async (client) => {
          const supplierId = uuid();
          const row = (
            await client.query(
              "INSERT INTO supplier(id,store_id,name,email,phone,address,notes,lead_time_days,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
              [
                supplierId,
                storeId,
                input.name,
                input.email,
                input.phone,
                input.address,
                input.notes,
                input.leadTimeDays,
                input.active,
              ],
            )
          ).rows[0];
          await event(client, "SupplierCreated", supplierId, {
            storeId,
            actorId: req.auth!.user.id,
          });
          return { status: 201, body: json(row) };
        },
      ),
    );
  });
  app.patch("/api/suppliers/:id", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      supplierId = id(req),
      input = supplierSchema.parse(req.body);
    const row = await db.transaction(async (client) => {
      const changed = (
        await client.query(
          "UPDATE supplier SET name=$3,email=$4,phone=$5,address=$6,notes=$7,lead_time_days=$8,active=$9 WHERE id=$1 AND store_id=$2 RETURNING *",
          [
            supplierId,
            storeId,
            input.name,
            input.email,
            input.phone,
            input.address,
            input.notes,
            input.leadTimeDays,
            input.active,
          ],
        )
      ).rows[0];
      if (!changed) throw new ApiError(404, "Supplier not found.");
      await event(client, "SupplierUpdated", supplierId, { storeId, actorId: req.auth!.user.id });
      return changed;
    });
    res.json(json(row));
  });
  app.get("/api/purchasing/drafts", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req);
    res.json(
      json(
        (
          await db.query(
            "SELECT d.*,s.name AS supplier_name FROM purchase_draft d LEFT JOIN supplier s ON s.id=d.supplier_id WHERE d.store_id=$1 ORDER BY d.created_at DESC LIMIT 250",
            [storeId],
          )
        ).rows,
      ),
    );
  });
  app.get("/api/purchasing/drafts/:id", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req);
    const row = (
      await db.query("SELECT * FROM purchase_draft WHERE id=$1 AND store_id=$2", [id(req), storeId])
    ).rows[0];
    if (!row) throw new ApiError(404, "Draft not found.");
    res.json(json(row));
  });
  app.post("/api/purchasing/drafts", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      input = purchaseSchema.parse(req.body);
    toResult(
      res,
      await idempotent(
        db,
        `purchase-draft:${storeId}`,
        req.get("Idempotency-Key"),
        input,
        async (client) => {
          await validatePurchase(client, storeId, input);
          const draftId = uuid();
          const row = (
            await client.query(
              "INSERT INTO purchase_draft(id,store_id,supplier_id,invoice_number,notes,lines,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *",
              [
                draftId,
                storeId,
                input.supplierId || null,
                input.invoiceNumber,
                input.notes,
                JSON.stringify(input.lines),
                req.auth!.user.id,
              ],
            )
          ).rows[0];
          await event(client, "PurchaseDraftCreated", draftId, {
            storeId,
            actorId: req.auth!.user.id,
          });
          return { status: 201, body: json(row) };
        },
      ),
    );
  });
  app.patch("/api/purchasing/drafts/:id", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      draftId = id(req),
      input = purchaseSchema.parse(req.body);
    const row = await db.transaction(async (client) => {
      await validatePurchase(client, storeId, input);
      const result = (
        await client.query(
          "UPDATE purchase_draft SET supplier_id=$3,invoice_number=$4,notes=$5,lines=$6::jsonb WHERE id=$1 AND store_id=$2 AND status='DRAFT' RETURNING *",
          [
            draftId,
            storeId,
            input.supplierId || null,
            input.invoiceNumber,
            input.notes,
            JSON.stringify(input.lines),
          ],
        )
      ).rows[0];
      if (!result) throw new ApiError(409, "Draft is unavailable or already approved.");
      return result;
    });
    res.json(json(row));
  });
  app.post("/api/purchasing/drafts/:id/approve", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      draftId = id(req);
    toResult(
      res,
      await idempotent(
        db,
        `purchase-approve:${storeId}`,
        req.get("Idempotency-Key"),
        { draftId },
        async (client) => {
          const draft = (
            await client.query(
              "SELECT * FROM purchase_draft WHERE id=$1 AND store_id=$2 FOR UPDATE",
              [draftId, storeId],
            )
          ).rows[0];
          if (!draft) throw new ApiError(404, "Draft not found.");
          if (draft.status !== "DRAFT")
            throw new ApiError(409, "This draft has already been approved.");
          const input = purchaseSchema.parse({
            supplierId: draft.supplier_id || undefined,
            invoiceNumber: draft.invoice_number,
            notes: draft.notes,
            lines: draft.lines,
          });
          const body = await createPurchase(client, storeId, req.auth!.user.id, input, draftId);
          await client.query("UPDATE purchase_draft SET status='APPROVED' WHERE id=$1", [draftId]);
          return { status: 201, body };
        },
      ),
    );
  });
  app.get("/api/purchasing/orders", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req);
    const orders = (
      await db.query(
        "SELECT id FROM purchase_order WHERE store_id=$1 ORDER BY created_at DESC LIMIT 250",
        [storeId],
      )
    ).rows;
    res.json(await Promise.all(orders.map((order) => getPurchase(db, order.id, storeId))));
  });
  app.get("/api/purchasing/orders/:id", roles("STORE", "ADMIN"), async (req, res) => {
    res.json(await getPurchase(db, id(req), await scope(db, req)));
  });
  app.post("/api/purchasing/orders", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      input = purchaseSchema.parse(req.body);
    toResult(
      res,
      await idempotent(
        db,
        `purchase-create:${storeId}`,
        req.get("Idempotency-Key"),
        input,
        async (client) => ({
          status: 201,
          body: await createPurchase(client, storeId, req.auth!.user.id, input),
        }),
      ),
    );
  });
  app.post("/api/purchasing/orders/:id/receive", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      orderId = id(req),
      input = receiptSchema.parse(req.body);
    toResult(
      res,
      await idempotent(
        db,
        `purchase-receive:${storeId}`,
        req.get("Idempotency-Key"),
        { orderId, ...input },
        async (client) => ({
          status: 201,
          body: await receivePurchase(client, storeId, req.auth!.user.id, orderId, input),
        }),
      ),
    );
  });
  app.get("/api/coupons", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req);
    res.json(
      json(
        (
          await db.query("SELECT * FROM coupon WHERE store_id=$1 ORDER BY created_at DESC", [
            storeId,
          ])
        ).rows,
      ),
    );
  });
  app.post("/api/coupons", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      input = couponSchema.parse(req.body);
    toResult(
      res,
      await idempotent(
        db,
        `coupon:${storeId}`,
        req.get("Idempotency-Key"),
        input,
        async (client) => {
          const couponId = uuid();
          const row = (
            await client.query(
              "INSERT INTO coupon(id,store_id,code,type,value,minimum_spend_cents,starts_at,expires_at,max_uses,per_customer_limit,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(store_id,code) DO NOTHING RETURNING *",
              [
                couponId,
                storeId,
                input.code,
                input.type,
                input.value,
                input.minimumSpendCents,
                input.startsAt,
                input.expiresAt,
                input.maxUses,
                input.perCustomerLimit,
                input.active,
              ],
            )
          ).rows[0];
          if (!row) throw new ApiError(409, "This coupon code already exists.");
          await event(client, "CouponCreated", couponId, { storeId, actorId: req.auth!.user.id });
          return { status: 201, body: json(row) };
        },
      ),
    );
  });
  app.patch("/api/coupons/:id", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      couponId = id(req),
      input = z.object({ active: z.boolean() }).strict().parse(req.body);
    const result = await db.transaction(async (client) => {
      const row = (
        await client.query("UPDATE coupon SET active=$3 WHERE id=$1 AND store_id=$2 RETURNING *", [
          couponId,
          storeId,
          input.active,
        ])
      ).rows[0];
      if (!row) throw new ApiError(404, "Coupon not found.");
      await event(client, "CouponUpdated", couponId, {
        storeId,
        actorId: req.auth!.user.id,
        active: input.active,
      });
      return row;
    });
    res.json(json(result));
  });
  app.post("/api/coupons/quote", roles("CUSTOMER"), async (req, res) => {
    const input = z
      .object({
        unitIds: z.array(uuidValue).min(1).max(30),
        couponCode: z.string().trim().max(40).optional(),
      })
      .strict()
      .parse(req.body);
    const pricing = await db.transaction(async (client) => {
      const rows = (
        await client.query(
          `${unitSelect} JOIN store s ON s.id=u.store_id WHERE u.id=ANY($1::uuid[]) AND u.status='RESERVED' AND u.owner_session_id=$2 AND u.reserved_until>now() AND p.active AND s.status='APPROVED'`,
          [input.unitIds, req.auth!.sessionId],
        )
      ).rows;
      if (rows.length !== input.unitIds.length)
        throw new ApiError(409, "Cart reservations changed. Refresh and try again.");
      return preparePricing(client, req.auth!, rows, input.couponCode);
    });
    res.json(pricing);
  });
  app.get("/api/reconciliation", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true);
    const rows = (
      await db.query(
        `SELECT o.id,o.status,o.payment_method,o.total_cents,o.refund_due_cents,o.refunded_cents,o.created_at,a.stripe_session_id,a.provider_status,a.checked_at,
      COALESCE((SELECT sum(i.price_cents)::int FROM order_unit i WHERE i.order_id=o.id),0) AS item_total_cents,
      COALESCE((SELECT sum(r.amount_cents)::int FROM order_refund r WHERE r.order_id=o.id),0) AS recorded_refunds_cents,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'amountCents',r.amount_cents,'checkedAt',r.checked_at)) FROM stripe_refund_attempt r WHERE r.order_id=o.id),'[]'::jsonb) AS refund_attempts
      FROM customer_order o LEFT JOIN stripe_payment_attempt a ON a.order_id=o.id WHERE o.store_id=$1 ORDER BY o.created_at DESC LIMIT 250`,
        [storeId],
      )
    ).rows;
    res.json(
      json(
        rows.map((row) => ({
          ...row,
          discrepancies: [
            ...(row.item_total_cents !== row.total_cents ? ["ITEM_TOTAL_MISMATCH"] : []),
            ...(row.recorded_refunds_cents !== row.refunded_cents
              ? ["REFUND_LEDGER_MISMATCH"]
              : []),
            ...(row.payment_method === "CARD" && row.status === "PAYMENT_PENDING"
              ? [row.stripe_session_id ? "PAYMENT_PENDING" : "PAYMENT_NOT_CREATED"]
              : []),
            ...(row.status === "REFUND_PENDING" ? ["REFUND_PENDING"] : []),
            ...(row.payment_method === "CARD" &&
            row.provider_status === "PAID" &&
            row.status === "PAYMENT_FAILED"
              ? ["PROVIDER_PAID_ORDER_FAILED"]
              : []),
          ],
        })),
      ),
    );
  });
  app.post("/api/reconciliation/:id/reconcile", roles("STORE", "ADMIN"), async (req, res) => {
    const storeId = await scope(db, req, true),
      orderId = id(req),
      input = z
        .object({ action: z.enum(["PAYMENT", "REFUND"]) })
        .strict()
        .parse(req.body);
    const row = (
      await db.query(
        "SELECT o.*,a.order_id AS attempt_exists FROM customer_order o LEFT JOIN stripe_payment_attempt a ON a.order_id=o.id WHERE o.id=$1 AND o.store_id=$2",
        [orderId, storeId],
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "Order not found.");
    if (!options.cardPayments || row.payment_method !== "CARD")
      throw new ApiError(409, "Provider reconciliation requires a configured card order.");
    if (input.action === "PAYMENT" && !row.attempt_exists)
      throw new ApiError(409, "The shopper must first start card payment.");
    const auditId = uuid();
    await db.transaction((client) =>
      event(client, "ReconciliationRequested", orderId, {
        storeId,
        actorId: req.auth!.user.id,
        auditId,
        action: input.action,
      }),
    );
    try {
      // Provider calls deliberately occur outside SQL transactions. Existing helpers own durable provider idempotency.
      if (input.action === "PAYMENT") await createStripePayment(db, orderId, options.origin);
      else await createStripeRefund(db, orderId);
      await db.transaction((client) =>
        event(client, "ReconciliationFinished", orderId, {
          storeId,
          actorId: req.auth!.user.id,
          auditId,
          action: input.action,
          outcome: "CHECKED",
        }),
      );
      res.json({ checked: true });
    } catch (error) {
      await db.transaction((client) =>
        event(client, "ReconciliationFinished", orderId, {
          storeId,
          actorId: req.auth!.user.id,
          auditId,
          action: input.action,
          outcome: "FAILED",
        }),
      );
      throw error;
    }
  });
}
