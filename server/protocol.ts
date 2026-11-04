import { logger } from "./logger.js";
import { createHash } from "node:crypto";
import { v7 as uuid } from "uuid";
import type { PoolClient } from "pg";
import type { Database } from "./db.js";
import { json } from "./db.js";
import type { Auth, Order } from "./types.js";
import { ApiError, conflict } from "./errors.js";

export interface MutationResult {
  status: number;
  body: unknown;
  replay?: boolean;
}
const canonical = (value: unknown): string =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
          .join(",")}}`
    : JSON.stringify(value);
export async function idempotent(
  db: Database,
  scope: string,
  key: string | undefined,
  payload: unknown,
  action: (client: PoolClient) => Promise<MutationResult>,
): Promise<MutationResult> {
  if (!key || key.length < 8 || key.length > 128 || !/^[\w.:-]+$/.test(key))
    throw new ApiError(
      400,
      "A valid Idempotency-Key header (8–128 characters) is required.",
      "IDEMPOTENCY_REQUIRED",
    );
  const fingerprint = createHash("sha256").update(canonical(payload)).digest("hex");
  return db.transaction(async (client) => {
    const claim = await client.query(
      "INSERT INTO idempotency_record(scope,key,request_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING key",
      [scope, key, fingerprint],
    );
    if (!claim.rowCount) {
      const row = (
        await client.query(
          "SELECT request_hash,response,status_code FROM idempotency_record WHERE scope=$1 AND key=$2",
          [scope, key],
        )
      ).rows[0];
      if (row.request_hash !== fingerprint)
        throw new ApiError(
          409,
          "This idempotency key was already used for a different request.",
          "IDEMPOTENCY_MISMATCH",
        );
      return {
        status: row.status_code === 201 ? 200 : row.status_code,
        body: row.response,
        replay: true,
      };
    }
    await client.query("SAVEPOINT operation");
    let result: MutationResult;
    try {
      result = await action(client);
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT operation");
      if (!(error instanceof ApiError)) throw error;
      result = { status: error.status, body: { error: error.message, code: error.code } };
    }
    await client.query(
      "UPDATE idempotency_record SET response=$3::jsonb,status_code=$4 WHERE scope=$1 AND key=$2",
      [scope, key, JSON.stringify(result.body), result.status],
    );
    return result;
  });
}
export async function event(client: PoolClient, type: string, id: string, payload: unknown) {
  await client.query(
    "INSERT INTO outbox(id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4::jsonb)",
    [uuid(), type, id, JSON.stringify(payload)],
  );
}
export const unitSelect = `SELECT u.*,p.name,p.sku,p.category,p.price_cents,p.image_url FROM inventory_unit u JOIN product p ON p.id=u.product_id`;
export function publicUnit(row: Record<string, unknown>, auth?: Auth) {
  const {
    id,
    product_id,
    store_id,
    staff_code,
    status,
    version,
    sale_epoch,
    name,
    sku,
    category,
    price_cents,
    image_url,
  } = row;
  const safe: Record<string, unknown> = {
    id,
    product_id,
    store_id,
    staff_code,
    status,
    version,
    sale_epoch,
    name,
    sku,
    category,
    price_cents,
    image_url,
  };
  if (row.owner_session_id === auth?.sessionId)
    Object.assign(safe, {
      reservation_id: row.reservation_id,
      reserved_until: row.reserved_until,
      checkout_order_id: row.checkout_order_id,
      checkout_protected_until: row.checkout_protected_until,
    });
  if (
    auth?.user.role === "ADMIN" ||
    (auth?.user.role === "STORE" && auth.user.storeId === row.store_id)
  )
    Object.assign(safe, { sold_order_id: row.sold_order_id });
  return json(safe);
}
export async function reserve(
  client: PoolClient,
  auth: Auth,
  input: { unitId: string; version: number },
): Promise<MutationResult> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [auth.sessionId]);
  const count = (
    await client.query(
      "SELECT count(*)::int AS count FROM inventory_unit WHERE owner_session_id=$1 AND status='RESERVED' AND (reserved_until>now() OR checkout_protected_until>now())",
      [auth.sessionId],
    )
  ).rows[0].count;
  if (count >= 30) throw new ApiError(409, "A cart can contain at most 30 physical units.");
  const row = (
    await client.query(
      `UPDATE inventory_unit u SET status='RESERVED',reservation_id=$3,owner_session_id=$4,reserved_until=now()+interval '15 minutes',version=u.version+1
  FROM product p,store s WHERE u.id=$1 AND u.version=$2 AND u.status='AVAILABLE' AND p.id=u.product_id AND p.active AND s.id=u.store_id AND s.status='APPROVED' RETURNING u.*`,
      [input.unitId, input.version, uuid(), auth.sessionId],
    )
  ).rows[0];
  if (!row) throw conflict();
  await event(client, "InventoryReserved", row.id, {
    reservationId: row.reservation_id,
    version: Number(row.version),
  });
  const detail = (await client.query(`${unitSelect} WHERE u.id=$1`, [row.id])).rows[0];
  return { status: 201, body: publicUnit(detail, auth) };
}
export async function release(
  client: PoolClient,
  auth: Auth,
  reservationId: string,
  version: number,
): Promise<MutationResult> {
  const row = (
    await client.query(
      `UPDATE inventory_unit SET status='AVAILABLE',reservation_id=NULL,owner_session_id=NULL,reserved_until=NULL,
  checkout_order_id=NULL,checkout_protected_until=NULL,version=version+1
  WHERE reservation_id=$1 AND owner_session_id=$2 AND version=$3 AND status='RESERVED'
  AND (checkout_order_id IS NULL OR checkout_protected_until<=now()) RETURNING *`,
      [reservationId, auth.sessionId, version],
    )
  ).rows[0];
  if (!row)
    throw conflict(
      "This reservation changed, belongs to another session, or is protected by checkout.",
    );
  await event(client, "InventoryReleased", row.id, { version: Number(row.version) });
  return { status: 200, body: json(row) };
}
export interface CheckoutInput {
  items: { unitId: string; reservationId: string; version: number }[];
  method: "DESK" | "DEVELOPMENT" | "CARD";
}
export async function getOrder(client: Pick<Database, "query">, id: string): Promise<Order> {
  const row = (
    await client.query(
      `SELECT o.*,u.name AS customer_name,s.name AS store_name FROM customer_order o JOIN app_user u ON u.id=o.user_id JOIN store s ON s.id=o.store_id WHERE o.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "Order not found.");
  const items = (
    await client.query(
      "SELECT unit_id,product_id,name,sku,price_cents,reservation_id,protected_version,sale_epoch,returned_at FROM order_unit WHERE order_id=$1 ORDER BY name,unit_id",
      [id],
    )
  ).rows;
  return {
    id: row.id,
    userId: row.user_id,
    storeId: row.store_id,
    status: row.status,
    paymentMethod: row.payment_method,
    totalCents: row.total_cents,
    customerName: row.customer_name,
    storeName: row.store_name,
    createdAt: row.created_at.toISOString(),
    paidAt: row.paid_at?.toISOString() || null,
    completedAt: row.completed_at?.toISOString() || null,
    refundDueCents: row.refund_due_cents,
    refundedCents: row.refunded_cents,
    failureReason: row.failure_reason,
    items: items.map((item) => ({
      unitId: item.unit_id,
      productId: item.product_id,
      name: item.name,
      sku: item.sku,
      priceCents: item.price_cents,
      reservationId: item.reservation_id,
      protectedVersion: Number(item.protected_version),
      saleEpoch: item.sale_epoch,
      returnedAt: item.returned_at?.toISOString() || null,
    })),
  };
}
export async function checkout(
  client: PoolClient,
  auth: Auth,
  input: CheckoutInput,
): Promise<MutationResult> {
  const items = [...input.items].sort((a, b) => a.unitId.localeCompare(b.unitId));
  if (new Set(items.map((item) => item.unitId)).size !== items.length)
    throw new ApiError(400, "Each physical unit can appear only once.");
  const rows = (
    await client.query(
      `${unitSelect} JOIN store s ON s.id=u.store_id WHERE u.id=ANY($1::uuid[]) AND p.active AND s.status='APPROVED'`,
      [items.map((item) => item.unitId)],
    )
  ).rows;
  if (rows.length !== items.length) throw conflict();
  const storeIds = new Set(rows.map((row) => row.store_id));
  if (storeIds.size !== 1) throw new ApiError(400, "Check out one store at a time.");
  const id = uuid(),
    total = rows.reduce((sum, row) => sum + row.price_cents, 0);
  if (input.method === "CARD" && total === 0)
    throw new ApiError(400, "Use desk checkout for a zero-value order.");
  if (!Number.isSafeInteger(total) || total > 2_147_483_647)
    throw new ApiError(400, "The order total exceeds the supported checkout limit.");
  await client.query(
    "INSERT INTO customer_order(id,user_id,owner_session_id,store_id,status,payment_method,total_cents) VALUES($1,$2,$3,$4,'PAYMENT_PENDING',$5,$6)",
    [id, auth.user.id, auth.sessionId, rows[0].store_id, input.method, total],
  );
  for (const item of items) {
    const protectedUnit = (
      await client.query(
        `UPDATE inventory_unit SET checkout_order_id=$5,checkout_protected_until=now()+CASE WHEN $6='CARD' THEN interval '40 minutes' ELSE interval '10 minutes' END,version=version+1
   WHERE id=$1 AND status='RESERVED' AND reservation_id=$2 AND owner_session_id=$3 AND version=$4 AND reserved_until>now()
   AND (checkout_order_id IS NULL OR checkout_protected_until<=now()) RETURNING *`,
        [item.unitId, item.reservationId, auth.sessionId, item.version, id, input.method],
      )
    ).rows[0];
    if (!protectedUnit)
      throw conflict(
        "A cart unit expired, changed, or already belongs to a checkout. Refresh your cart.",
      );
    const product = rows.find((row) => row.id === item.unitId)!;
    await client.query(
      `INSERT INTO order_unit(order_id,unit_id,product_id,reservation_id,protected_version,sale_epoch,name,sku,price_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        item.unitId,
        product.product_id,
        item.reservationId,
        protectedUnit.version,
        protectedUnit.sale_epoch,
        product.name,
        product.sku,
        product.price_cents,
      ],
    );
  }
  await event(client, "CheckoutPrepared", id, {
    totalCents: total,
    paymentMethod: input.method,
    paymentIdempotencyKey: `order:${id}`,
  });
  return { status: 201, body: await getOrder(client, id) };
}
async function finalize(client: PoolClient, orderId: string): Promise<void> {
  const order = (
    await client.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [orderId])
  ).rows[0];
  if (!order || order.status !== "PAID") return;
  const items = (
    await client.query("SELECT * FROM order_unit WHERE order_id=$1 ORDER BY unit_id", [orderId])
  ).rows;
  await client.query("SAVEPOINT finalization");
  for (const item of items) {
    const row = (
      await client.query(
        `UPDATE inventory_unit SET status='SOLD',sold_order_id=$1,sold_at=now(),reservation_id=NULL,owner_session_id=NULL,reserved_until=NULL,
   checkout_order_id=NULL,checkout_protected_until=NULL,version=version+1
   WHERE id=$2 AND status='RESERVED' AND reservation_id=$3 AND owner_session_id=$4 AND checkout_order_id=$1 AND version=$5 AND sale_epoch=$6 RETURNING id`,
        [
          orderId,
          item.unit_id,
          item.reservation_id,
          order.owner_session_id,
          item.protected_version,
          item.sale_epoch,
        ],
      )
    ).rows[0];
    if (!row) {
      await client.query("ROLLBACK TO SAVEPOINT finalization");
      await client.query(
        "UPDATE customer_order SET status='REFUND_PENDING',refund_due_cents=total_cents-refunded_cents,failure_reason='Payment received after inventory protection was lost. Refund or manual review required.' WHERE id=$1",
        [orderId],
      );
      await event(client, "RefundRequired", orderId, {
        reason: "INVENTORY_CONFLICT",
        paymentReference: order.payment_reference,
      });
      return;
    }
    await client.query(
      "INSERT INTO unit_sale(unit_id,sale_epoch,order_id,price_cents) VALUES($1,$2,$3,$4)",
      [item.unit_id, item.sale_epoch, orderId, item.price_cents],
    );
  }
  await client.query(
    "UPDATE customer_order SET status='COMPLETED',completed_at=now() WHERE id=$1 AND status='PAID'",
    [orderId],
  );
  await event(client, "InventorySold", orderId, {
    unitIds: items.map((item) => item.unit_id),
    totalCents: order.total_cents,
  });
}
export async function recordPayment(
  client: PoolClient,
  orderId: string,
  eventId: string,
  outcome: "SUCCEEDED" | "FAILED",
  source: string,
): Promise<MutationResult> {
  const order = (
    await client.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [orderId])
  ).rows[0];
  if (!order) throw new ApiError(404, "Order not found.");
  const inserted = await client.query(
    "INSERT INTO payment_event(event_id,order_id,outcome,source) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id",
    [eventId, orderId, outcome, source],
  );
  if (!inserted.rowCount) {
    const previous = (
      await client.query("SELECT order_id,outcome,source FROM payment_event WHERE event_id=$1", [
        eventId,
      ])
    ).rows[0];
    if (previous.order_id !== orderId || previous.outcome !== outcome || previous.source !== source)
      throw conflict("Payment event does not match its original request.");
    return { status: 200, body: await getOrder(client, orderId) };
  }
  if (
    !["PAYMENT_PENDING", "PAYMENT_FAILED"].includes(order.status) ||
    (order.status === "PAYMENT_FAILED" && outcome === "FAILED")
  )
    return { status: 200, body: await getOrder(client, orderId) };
  if (outcome === "FAILED") {
    await client.query(
      "UPDATE customer_order SET status='PAYMENT_FAILED',failure_reason='Payment was declined or cancelled.' WHERE id=$1",
      [orderId],
    );
    // Release only the exact order binding/version. A stale failure cannot free a newer checkout.
    await client.query(
      `UPDATE inventory_unit u SET status='AVAILABLE',reservation_id=NULL,owner_session_id=NULL,reserved_until=NULL,checkout_order_id=NULL,checkout_protected_until=NULL,version=u.version+1
   FROM order_unit i WHERE i.order_id=$1 AND u.id=i.unit_id AND u.status='RESERVED' AND u.reservation_id=i.reservation_id AND u.owner_session_id=$2 AND u.checkout_order_id=$1 AND u.version=i.protected_version`,
      [orderId, order.owner_session_id],
    );
    await event(client, "PaymentFailed", orderId, {});
  } else {
    await client.query(
      "UPDATE customer_order SET status='PAID',paid_at=now(),payment_reference=$2 WHERE id=$1",
      [orderId, `${source}:${orderId}`],
    );
    await event(client, "PaymentReceived", orderId, { source });
    await finalize(client, orderId);
  }
  return { status: 200, body: await getOrder(client, orderId) };
}
export async function returnUnit(
  client: PoolClient,
  unitId: string,
  input: { orderId: string; version: number; reason: string },
): Promise<MutationResult> {
  const order = (
    await client.query("SELECT * FROM customer_order WHERE id=$1 FOR UPDATE", [input.orderId])
  ).rows[0];
  if (!order || !order.completed_at) throw conflict("Only a completed sale can be returned.");
  const row = (
    await client.query(
      `UPDATE inventory_unit SET status='AVAILABLE',sold_order_id=NULL,sold_at=NULL,sale_epoch=sale_epoch+1,version=version+1
  WHERE id=$1 AND status='SOLD' AND sold_order_id=$2 AND version=$3 RETURNING *`,
      [unitId, input.orderId, input.version],
    )
  ).rows[0];
  if (!row) throw conflict("The unit is no longer sold against this order or its version changed.");
  const changed = await client.query(
    "UPDATE unit_sale SET returned_at=now() WHERE unit_id=$1 AND sale_epoch=$2 AND order_id=$3 AND returned_at IS NULL RETURNING *",
    [unitId, row.sale_epoch - 1, input.orderId],
  );
  if (!changed.rowCount) throw conflict("The sale was already returned.");
  await client.query(
    "UPDATE order_unit SET returned_at=now(),return_reason=$3 WHERE order_id=$1 AND unit_id=$2",
    [input.orderId, unitId, input.reason],
  );
  await client.query(
    "UPDATE customer_order SET status=CASE WHEN refund_due_cents+$2>0 THEN 'REFUND_PENDING' ELSE status END,refund_due_cents=refund_due_cents+$2,failure_reason=CASE WHEN $2>0 THEN 'Returned goods require a refund.' ELSE failure_reason END WHERE id=$1",
    [input.orderId, changed.rows[0].price_cents],
  );
  await event(client, "InventoryReturned", unitId, {
    orderId: input.orderId,
    saleEpoch: row.sale_epoch,
    reason: input.reason,
  });
  return { status: 200, body: json(row) };
}
export async function expireReservations(db: Database, batch = 200): Promise<number> {
  return db.transaction(async (client) => {
    const rows = (
      await client.query(
        `WITH expired AS (SELECT id,version,reservation_id,owner_session_id FROM inventory_unit
   WHERE status='RESERVED' AND reserved_until<=now() AND (checkout_order_id IS NULL OR checkout_protected_until<=now())
   ORDER BY reserved_until FOR UPDATE SKIP LOCKED LIMIT $1)
   UPDATE inventory_unit u SET status='AVAILABLE',reservation_id=NULL,owner_session_id=NULL,reserved_until=NULL,checkout_order_id=NULL,checkout_protected_until=NULL,version=u.version+1
   FROM expired e WHERE u.id=e.id AND u.version=e.version AND u.reservation_id=e.reservation_id AND u.owner_session_id=e.owner_session_id
   AND u.status='RESERVED' AND u.reserved_until<=now() AND (u.checkout_order_id IS NULL OR u.checkout_protected_until<=now()) RETURNING u.id,u.version`,
        [batch],
      )
    ).rows;
    for (const row of rows)
      await event(client, "ReservationExpired", row.id, { version: Number(row.version) });
    return rows.length;
  });
}
export async function reconcilePayments(db: Database): Promise<void> {
  // A persisted PAID order is retried; payment is never charged a second time.
  const rows = (
    await db.query("SELECT id FROM customer_order WHERE status='PAID' ORDER BY paid_at LIMIT 100")
  ).rows;
  for (const row of rows) await db.transaction((client) => finalize(client, row.id));
  await db.query(`UPDATE customer_order o SET status='PAYMENT_FAILED',failure_reason='Checkout protection expired before payment confirmation.'
  WHERE o.status='PAYMENT_PENDING' AND o.created_at<now()-interval '1 day'
  AND NOT EXISTS(SELECT 1 FROM inventory_unit u WHERE u.checkout_order_id=o.id AND u.checkout_protected_until>now())`);
}
export async function publishOutbox(db: Database): Promise<number> {
  // Delivery commits to a durable journal with event-ID deduplication. External adapters
  // can consume this journal without placing network I/O inside inventory transactions.
  return db.transaction(async (client) => {
    const rows = (
      await client.query(
        "SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 200",
      )
    ).rows;
    for (const row of rows) {
      await client.query(
        "INSERT INTO event_delivery(event_id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
        [row.id, row.event_type, row.aggregate_id, JSON.stringify(row.payload)],
      );
      await client.query("UPDATE outbox SET published_at=now(),attempts=attempts+1 WHERE id=$1", [
        row.id,
      ]);
    }
    return rows.length;
  });
}
export function startWorkers(db: Database) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await expireReservations(db);
      await reconcilePayments(db);
      await publishOutbox(db);
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Recovery worker failed",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), 5_000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
