import type { PoolClient } from "pg";
import { v7 as uuid } from "uuid";
import { z } from "zod";
import type { Database } from "../db.js";
import { json } from "../db.js";
import { ApiError } from "../errors.js";
import { event } from "../protocol.js";
import { planById } from "../plans.js";

export const purchaseLineSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(10000),
    unitCostCents: z.number().int().min(0).max(100_000_000),
  })
  .strict();
export const purchaseSchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    invoiceNumber: z.string().trim().max(200).default(""),
    notes: z.string().max(3000).default(""),
    lines: z.array(purchaseLineSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (input) => new Set(input.lines.map((line) => line.productId)).size === input.lines.length,
    "Combine duplicate product lines.",
  );
export type PurchaseInput = z.infer<typeof purchaseSchema>;
type Queryable = Pick<Database, "query">;
export async function validatePurchase(client: Queryable, storeId: string, input: PurchaseInput) {
  if (
    input.supplierId &&
    !(
      await client.query("SELECT id FROM supplier WHERE id=$1 AND store_id=$2 AND active", [
        input.supplierId,
        storeId,
      ])
    ).rowCount
  )
    throw new ApiError(404, "Supplier not found.");
  const products = await client.query(
    "SELECT id FROM product WHERE store_id=$1 AND active AND id=ANY($2::uuid[])",
    [storeId, input.lines.map((line) => line.productId)],
  );
  if (products.rowCount !== input.lines.length)
    throw new ApiError(
      400,
      "Every purchase line must match an active catalog product in this store.",
    );
}
export async function getPurchase(client: Queryable, orderId: string, storeId: string) {
  const row = (
    await client.query(
      "SELECT p.*,s.name AS supplier_name FROM purchase_order p JOIN supplier s ON s.id=p.supplier_id WHERE p.id=$1 AND p.store_id=$2",
      [orderId, storeId],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "Purchase order not found.");
  const lines = (
    await client.query(
      "SELECT l.*,p.name,p.sku FROM purchase_order_line l JOIN product p ON p.id=l.product_id WHERE l.order_id=$1 ORDER BY p.name,l.id",
      [orderId],
    )
  ).rows;
  const receipts = (
    await client.query(
      "SELECT r.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('lineId',l.line_id,'quantity',l.quantity)) FROM purchase_receipt_line l WHERE l.receipt_id=r.id),'[]'::jsonb) AS lines FROM purchase_receipt r WHERE order_id=$1 ORDER BY created_at DESC",
      [orderId],
    )
  ).rows;
  return json({ ...row, lines, receipts });
}
export async function createPurchase(
  client: PoolClient,
  storeId: string,
  userId: string,
  input: PurchaseInput,
  draftId?: string,
) {
  if (!input.supplierId)
    throw new ApiError(400, "Choose a supplier before approving this purchase.");
  await validatePurchase(client, storeId, input);
  const orderId = uuid();
  await client.query(
    "INSERT INTO purchase_order(id,store_id,supplier_id,draft_id,invoice_number,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [orderId, storeId, input.supplierId, draftId || null, input.invoiceNumber, input.notes, userId],
  );
  for (const line of input.lines)
    await client.query(
      "INSERT INTO purchase_order_line(id,order_id,product_id,quantity,unit_cost_cents) VALUES($1,$2,$3,$4,$5)",
      [uuid(), orderId, line.productId, line.quantity, line.unitCostCents],
    );
  await event(client, "PurchaseOrderCreated", orderId, {
    storeId,
    createdBy: userId,
    draftId: draftId || null,
  });
  return getPurchase(client, orderId, storeId);
}
export const receiptSchema = z
  .object({
    reference: z.string().trim().max(200).default(""),
    lines: z
      .array(
        z
          .object({ lineId: z.string().uuid(), quantity: z.number().int().min(1).max(10000) })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (input) => new Set(input.lines.map((line) => line.lineId)).size === input.lines.length,
    "Each line may appear only once.",
  );
export async function receivePurchase(
  client: PoolClient,
  storeId: string,
  userId: string,
  orderId: string,
  input: z.infer<typeof receiptSchema>,
) {
  // Store-before-order locking serializes inventory plan capacity with catalog stock creation.
  const store = (await client.query("SELECT plan FROM store WHERE id=$1 FOR UPDATE", [storeId]))
    .rows[0];
  if (!store) throw new ApiError(404, "Store not found.");
  const order = (
    await client.query("SELECT * FROM purchase_order WHERE id=$1 AND store_id=$2 FOR UPDATE", [
      orderId,
      storeId,
    ])
  ).rows[0];
  if (!order) throw new ApiError(404, "Purchase order not found.");
  const lines = (
    await client.query(
      "SELECT * FROM purchase_order_line WHERE order_id=$1 ORDER BY id FOR UPDATE",
      [orderId],
    )
  ).rows;
  for (const requested of input.lines) {
    const line = lines.find((entry) => entry.id === requested.lineId);
    if (!line || line.received_quantity + requested.quantity > line.quantity)
      throw new ApiError(
        409,
        "Receiving exceeds the outstanding purchase quantity.",
        "OVER_RECEIPT",
      );
  }
  const quantity = input.lines.reduce((sum, line) => sum + line.quantity, 0);
  if (quantity > 10000) throw new ApiError(400, "Receive at most 10,000 physical units at a time.");
  const limit = planById(store.plan).limits.units;
  if (limit !== null) {
    const count = (
      await client.query(
        "SELECT count(*)::int AS count FROM inventory_unit WHERE store_id=$1 AND status<>'SOLD'",
        [storeId],
      )
    ).rows[0].count;
    if (count + quantity > limit)
      throw new ApiError(
        402,
        "This receipt exceeds the store's inventory plan limit.",
        "PLAN_LIMIT",
      );
  }
  const receiptId = uuid(),
    units: { id: string; staffCode: string; productId: string }[] = [];
  await client.query(
    "INSERT INTO purchase_receipt(id,order_id,received_by,reference) VALUES($1,$2,$3,$4)",
    [receiptId, orderId, userId, input.reference],
  );
  for (const requested of input.lines) {
    const line = lines.find((entry) => entry.id === requested.lineId)!;
    await client.query(
      "UPDATE purchase_order_line SET received_quantity=received_quantity+$2 WHERE id=$1",
      [line.id, requested.quantity],
    );
    await client.query(
      "INSERT INTO purchase_receipt_line(receipt_id,line_id,quantity) VALUES($1,$2,$3)",
      [receiptId, line.id, requested.quantity],
    );
    const ids = Array.from({ length: requested.quantity }, () => uuid());
    const codes = ids.map((id) => `TC-${id.replaceAll("-", "").toUpperCase()}`);
    await client.query(
      "INSERT INTO inventory_unit(id,product_id,store_id,staff_code,unit_cost_cents,purchase_receipt_id) SELECT x.id,$2,$3,x.code,$4,$5 FROM unnest($1::uuid[],$6::text[]) AS x(id,code)",
      [ids, line.product_id, storeId, line.unit_cost_cents, receiptId, codes],
    );
    ids.forEach((id, index) =>
      units.push({ id, staffCode: codes[index], productId: line.product_id }),
    );
  }
  await client.query(
    "UPDATE purchase_order SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM purchase_order_line WHERE order_id=$1 AND received_quantity<quantity) THEN 'RECEIVED' ELSE 'PARTIAL' END WHERE id=$1",
    [orderId],
  );
  await event(client, "PurchaseReceived", orderId, {
    storeId,
    receiptId,
    receivedBy: userId,
    quantity,
  });
  return { receiptId, units, order: await getPurchase(client, orderId, storeId) };
}
