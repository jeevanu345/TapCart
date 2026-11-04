import type { Express } from "express";
import type { Database } from "../db.js";
import { z } from "zod";
import { v7 as uuid } from "uuid";
import type { AppOptions } from "../types.js";
import { ApiError } from "../errors.js";
import { requireAuth, requireStore, roles } from "../auth.js";
import {
  checkout,
  event,
  getOrder,
  idempotent,
  publicUnit,
  recordPayment,
  release,
  reserve,
  returnUnit,
  unitSelect,
} from "../protocol.js";
import { uuidValue, version, id, toResult, authorizeOrder, storeScope } from "./shared.js";
import { createStripePayment } from "../stripe.js";
import { createStripeRefund } from "../refunds.js";
import { renderInvoice } from "../invoice.js";
export function registerShoppingRoutes(app: Express, db: Database, options: AppOptions) {
  app.post("/api/orders/:id/card-payment", roles("CUSTOMER"), async (req, res) => {
    if (!options.cardPayments) throw new ApiError(503, "Card payments are not configured.");
    const order = await authorizeOrder(db, req, id(req));
    res.json(await createStripePayment(db, order.id, options.origin));
  });
  app.post("/api/orders/:id/card-refund", roles("STORE", "ADMIN"), async (req, res) => {
    if (!options.cardPayments) throw new ApiError(503, "Card payments are not configured.");
    const order = await authorizeOrder(db, req, id(req), true);
    if (req.auth!.user.role !== "ADMIN") await requireStore(db, req.auth!.user, order.storeId);
    res.json(await createStripeRefund(db, order.id));
  });
  app.post("/api/reservations", roles("CUSTOMER"), async (req, res) => {
    const input = z.object({ unitId: uuidValue, version }).parse(req.body);
    toResult(
      res,
      await idempotent(
        db,
        `reserve:${req.auth!.sessionId}`,
        req.get("Idempotency-Key"),
        input,
        (client) => reserve(client, req.auth!, input),
      ),
    );
  });
  app.delete("/api/reservations/:id", roles("CUSTOMER"), async (req, res) => {
    const input = z.object({ version }).parse(req.body),
      reservationId = id(req);
    toResult(
      res,
      await idempotent(
        db,
        `release:${req.auth!.sessionId}`,
        req.get("Idempotency-Key"),
        { reservationId, ...input },
        (client) => release(client, req.auth!, reservationId, input.version),
      ),
    );
  });
  app.get("/api/cart", roles("CUSTOMER"), async (req, res) => {
    res.json(
      (
        await db.query(
          `${unitSelect} WHERE u.owner_session_id=$1 AND u.status='RESERVED' ORDER BY u.created_at,u.id`,
          [req.auth!.sessionId],
        )
      ).rows.map((row) => publicUnit(row, req.auth)),
    );
  });
  app.post("/api/orders", roles("CUSTOMER"), async (req, res) => {
    const input = z
      .object({
        items: z
          .array(z.object({ unitId: uuidValue, reservationId: uuidValue, version }))
          .min(1)
          .max(30),
        method: z.enum(["DESK", "DEVELOPMENT", "CARD"]),
      })
      .parse(req.body);
    if (input.method === "CARD" && !options.cardPayments)
      throw new ApiError(403, "Card payments are not configured.");
    if (input.method === "DEVELOPMENT" && (!options.developmentPayments || options.production))
      throw new ApiError(403, "Development payments are disabled.");
    toResult(
      res,
      await idempotent(
        db,
        `checkout:${req.auth!.sessionId}`,
        req.get("Idempotency-Key"),
        input,
        (client) => checkout(client, req.auth!, input),
      ),
    );
  });
  app.get("/api/orders", requireAuth, async (req, res) => {
    const user = req.auth!.user,
      storeId = storeScope(req);
    const rows = (
      await db.query(
        `SELECT id FROM customer_order WHERE ($1!='CUSTOMER' OR user_id=$2) AND ($1!='STORE' OR store_id=$3) ORDER BY created_at DESC LIMIT 250`,
        [user.role, user.id, storeId],
      )
    ).rows;
    res.json(await Promise.all(rows.map((row) => getOrder(db, row.id))));
  });
  app.get("/api/orders/:id", requireAuth, async (req, res) =>
    res.json(await authorizeOrder(db, req, id(req))),
  );
  app.get("/api/orders/:id/invoice", requireAuth, async (req, res) => {
    const order = await authorizeOrder(db, req, id(req));
    if (!["COMPLETED", "REFUND_PENDING", "REFUNDED"].includes(order.status))
      throw new ApiError(409, "The invoice is available after payment confirmation.");
    if (req.query.format === "html") {
      res.type("html").send(renderInvoice(order));
      return;
    }
    res.json({
      ...order,
      invoiceNumber: `TC-${order.id.slice(-12).toUpperCase()}`,
      currency: "INR",
      issuedAt: order.completedAt || order.paidAt,
    });
  });
  app.post("/api/orders/:id/confirm-payment", roles("STORE", "ADMIN"), async (req, res) => {
    const order = await authorizeOrder(db, req, id(req), true);
    await requireStore(db, req.auth!.user, order.storeId);
    if (order.paymentMethod !== "DESK")
      throw new ApiError(409, "Only pay-at-desk orders can be confirmed here.");
    toResult(
      res,
      await idempotent(
        db,
        `cash:${req.auth!.user.id}`,
        req.get("Idempotency-Key"),
        { orderId: order.id },
        (client) => recordPayment(client, order.id, `cash:${order.id}`, "SUCCEEDED", "DESK"),
      ),
    );
  });
  app.post("/api/orders/:id/development-payment", roles("CUSTOMER"), async (req, res) => {
    if (!options.developmentPayments || options.production)
      throw new ApiError(404, "Route not found.");
    const input = z.object({ outcome: z.enum(["SUCCEEDED", "FAILED"]) }).parse(req.body),
      order = await authorizeOrder(db, req, id(req));
    if (order.paymentMethod !== "DEVELOPMENT")
      throw new ApiError(409, "This order is not a development payment.");
    toResult(
      res,
      await idempotent(
        db,
        `dev-payment:${req.auth!.user.id}`,
        req.get("Idempotency-Key"),
        { orderId: order.id, ...input },
        (client) =>
          recordPayment(client, order.id, `development:${order.id}`, input.outcome, "DEVELOPMENT"),
      ),
    );
  });
  app.post("/api/orders/:id/confirm-refund", roles("STORE", "ADMIN"), async (req, res) => {
    const order = await authorizeOrder(db, req, id(req), true);
    if (req.auth!.user.role !== "ADMIN") await requireStore(db, req.auth!.user, order.storeId);
    toResult(
      res,
      await idempotent(
        db,
        `refund:${req.auth!.user.id}`,
        req.get("Idempotency-Key"),
        { orderId: order.id },
        async (client) => {
          const current = (
            await client.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [order.id])
          ).rows[0];
          if (current.status !== "REFUND_PENDING" || current.refund_due_cents <= 0)
            throw new ApiError(409, "This order is not awaiting a refund.");
          if (current.payment_method === "CARD")
            throw new ApiError(409, "Card refunds must be processed through the payment provider.");
          const amount = current.refund_due_cents;
          await client.query(
            "INSERT INTO order_refund(id,order_id,amount_cents,source,confirmed_by) VALUES($1,$2,$3,$4,$5)",
            [uuid(), order.id, amount, "STAFF", req.auth!.user.id],
          );
          await client.query(
            "UPDATE customer_order SET refunded_cents=refunded_cents+refund_due_cents,refund_due_cents=0,status=CASE WHEN refunded_cents+refund_due_cents>=total_cents THEN 'REFUNDED' ELSE 'COMPLETED' END WHERE id=$1",
            [order.id],
          );
          await event(client, "RefundConfirmed", order.id, {
            confirmedBy: req.auth!.user.id,
            amountCents: amount,
          });
          return { status: 200, body: await getOrder(client, order.id) };
        },
      ),
    );
  });
  app.post("/api/units/:id/return", roles("STORE", "ADMIN"), async (req, res) => {
    const unitId = id(req),
      input = z
        .object({ orderId: uuidValue, version, reason: z.string().trim().min(5).max(500) })
        .parse(req.body);
    const order = await authorizeOrder(db, req, input.orderId, true);
    if (req.auth!.user.role !== "ADMIN") await requireStore(db, req.auth!.user, order.storeId);
    if (!order.items.some((item: { unitId: string }) => item.unitId === unitId))
      throw new ApiError(404, "Unit not found in this order.");
    toResult(
      res,
      await idempotent(
        db,
        `return:${req.auth!.user.id}`,
        req.get("Idempotency-Key"),
        { unitId, ...input },
        (client) => returnUnit(client, unitId, input),
      ),
    );
  });
}
