# Purchasing, promotions and payment reconciliation

All routes use the existing authenticated session and CSRF protection. Store users are confined to their store; administrators select an approved store with `?storeId=<uuid>`. Supplier and purchase lists are available to store staff. Writes, receipt approval, coupons and reconciliation require an owner, manager or administrator.

## Purchasing

`GET/POST /api/suppliers` and `PATCH /api/suppliers/:id` manage supplier contact details, active status and `leadTimeDays`.

`POST /api/purchasing/drafts` accepts `{ supplierId?, invoiceNumber, notes?, lines: [{ productId, quantity, unitCostCents }] }`. Products must exist in the same store. Invoice extraction supplies a proposal to this endpoint; unresolved catalog matches must be reviewed before submission. Draft creation never changes stock. `PATCH /api/purchasing/drafts/:id` saves staff corrections. The Purchasing screen opens an extracted draft with `?draft=<uuid>`.

`POST /api/purchasing/drafts/:id/approve` creates an open purchase order from the saved, reviewed draft. A supplier is required. `POST /api/purchasing/orders` creates an order directly from the same validated input. Approval still creates no inventory.

`POST /api/purchasing/orders/:id/receive` accepts `{ reference?, lines: [{ lineId, quantity }] }` and requires an `Idempotency-Key`. Each successful receipt creates distinct `AVAILABLE` physical inventory units with unique staff codes, `unit_cost_cents` and `purchase_receipt_id`. Partial receipts update outstanding quantities. A store/order lock serializes concurrent receipts; an excessive quantity rolls back the entire receipt. Plan capacity is checked under the store lock. Replaying the same key returns the original receipt and original unit IDs.

Outstanding procurement is `sum(purchase_order_line.quantity - received_quantity)` for purchase orders in `OPEN` or `PARTIAL` status. Receiving the last outstanding quantity marks the order `RECEIVED`. The receipt response includes the created unit IDs and staff codes; tags can then be exported through existing inventory tools.

## Promotions

`GET/POST /api/coupons` lists and creates codes. Codes are store-specific and case insensitive. `type` is `PERCENT` (integer 1–100) or `FIXED` (integer paise). Optional `startsAt`, `expiresAt`, `maxUses`, `perCustomerLimit` and `minimumSpendCents` restrict eligibility. `PATCH /api/coupons/:id` accepts `{ active }`; discount terms cannot be edited after creation.

`POST /api/coupons/quote` accepts `{ unitIds, couponCode? }` from the customer's live reservations. It validates current server prices and eligibility without writing a redemption. Quotes are informational; checkout validates again.

`preparePricing(client, auth, unitRows, couponCode?)` reads server prices and locks the coupon inside the checkout transaction. `claimPricing(client, auth, orderId, pricing)` claims its use in that same transaction. The existing checkout idempotency record covers the entire action. Concurrent claims cannot exceed global or per-customer limits. A rejected checkout rolls back the redemption and counter. Uses remain consumed for prepared orders that fail or are abandoned, preventing repeated claims of a limited promotion.

The order stores subtotal, discount and coupon-code snapshots. Proportional integer discounts use stable largest-remainder allocation across physical units. Each order unit stores its list price, discount and actual paid price; allocated discounts sum exactly and never exceed an item's value. Stripe line amounts and unit-sale/refund accounting use actual paid prices. A 100% discount requires desk checkout for a zero-total order. Historical orders are backfilled with list price equal to paid price and zero discount.

## Reconciliation

`GET /api/reconciliation` compares stored order totals with item snapshots and confirmed refunds with the refund ledger. It shows persisted provider payment attempts and individual refund attempts, with pending/missing-attempt indicators. Results are limited to the latest 250 store orders.

`POST /api/reconciliation/:id/reconcile` accepts `{ action: "PAYMENT" | "REFUND" }`. It only handles scoped card orders and delegates to the existing durable provider helpers outside SQL transactions. Payment reconciliation requires a previously persisted payment attempt. Refund reconciliation may initiate the outstanding provider refund through its existing idempotent helper. Requested, checked and failed operations are recorded in the activity outbox. The dashboard never marks an order paid based on client input.
