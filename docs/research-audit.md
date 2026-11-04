# Research and legacy implementation audit

Audit baseline: the original Next.js source, all 1,070 lines of `nfc.tex`, four SQL scripts, six `lib` files, all 20 API route modules, and the separate admin session route. This document records the source contract and defects before the Node.js / React / TypeScript rebuild; it does not certify the new implementation or reproduce the paper's experiments.

## Paper coverage and authority

| Paper material                              | Implementation consequence                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Introduction and related work, lines 99–193 | NFC interaction and serialized identity are established; the contribution is the transaction protocol, not a new NFC capability.                                                                                                                                                                                                |
| Model and requirements, 194–263             | One authoritative PostgreSQL database, authenticated sessions, checked affected-row counts, Read Committed or stronger, database-clock leases, and no atomic payment/database commit. Requirements R1–R7 cover exclusivity, ownership, stale-write rejection, sale uniqueness, retry safety, reclamation, and payment recovery. |
| Unit identity and carrier, 264–299          | Separate physical unit UUID from SKU; optional GTIN/serial and staff code. HTTPS `/u/{uuid}` identity, provisioning manifest, write/read-back checks, and label attachment procedures.                                                                                                                                          |
| Protocol, 300–558                           | Separate unit and order machines; atomic reservation/release/expiry; bounded checkout protection with rebinding guard; durable idempotency; payment saga; return epochs; transactional outbox. Exact predicates below.                                                                                                          |
| Correctness and TLA+, 559–650               | Enforce structural invariants in SQL, increment version on every transition, preserve unique unit/epoch sales. Claimed exhaustive model has one unit, two sessions and three orders; two-unit exploration was stopped before completion.                                                                                        |
| Security, 651–683                           | Static tags identify records; authenticated tags require real key management, MAC and fresh-counter verification. Web authorization, session, CSRF, abuse, privacy and retention controls are separate requirements.                                                                                                            |
| Experiments, 684–852                        | Conditional UPDATE versus SELECT FOR UPDATE and intentionally unsafe baseline; hot-unit contention, low-contention throughput, emulated RTT, and eleven fault scenarios. Do not reuse claimed numbers as measurements of this rebuild.                                                                                          |
| Limitations and conclusion, 853–930         | NFC phone/material reliability, encoder throughput, within-subject usability study, physical binding, offline limits, and lease policy remain empirical work.                                                                                                                                                                   |
| Bibliography, 931–1070                      | Supporting citations were read as part of the supplied document; external sources and historical prices were not independently verified in this code audit.                                                                                                                                                                     |

The paper is a design source, not an executable specification. Its abridged schema does **not** enforce everything its prose claims: a SOLD row may retain `owner_session_id`, and stale lease/protection/timestamp fields are incompletely constrained. The rebuild should strengthen checks to implement I1–I3 literally. The conclusion and contribution list say every guard is necessary, whereas the abstract and model discussion explicitly exempt the version guard from observed safety counterexamples. Version remains required for the separate stale-write requirement R3.

## Required data and invariants

- `product` describes a SKU; `inventory_unit` describes one sellable object. Availability derives from unit rows, never a mutable SKU stock counter. Preserve tenant/store bindings with database constraints and scoped queries.
- AVAILABLE has no reservation, owner, lease, checkout binding/protection, sale order or sale timestamp. RESERVED has a unique reservation ID, owning session and reservation deadline, no sold fields, and either both checkout fields or neither. SOLD has sold order/time and no reservation, owner, lease or checkout fields.
- `version` and `sale_epoch` are nonnegative; every successful unit transition increments version exactly once. Only a return increments sale epoch. A unique `(unit_id, sale_epoch)` sale record survives returns and prevents a second sale in the same epoch.
- `order_unit` durably records each unit's reservation ID, checkout-protected version and immutable price snapshot. Do not derive the protected version from a later read. Completed orders must have their original unit/epoch sales; a later return may legitimately make the current unit AVAILABLE or sold to someone else.
- Orders use CREATED → PAYMENT_PENDING → PAID → COMPLETED, with PAYMENT_FAILED and REFUND_PENDING → REFUNDED branches. Refund history, attempts and payment status are distinct from current physical unit availability. Only authenticated payment evidence or authorized desk collection can establish paid status.
- Use integer minor currency units, validated finite nonnegative amounts, server-side prices/coupon rules, nonempty carts, distinct unit IDs, and bounded inputs. A unit appears at most once per order. Reject cross-store carts unless an explicit multi-store protocol exists.

## Transition contract

Every mutation uses a short database transaction, checks exactly which rows changed, and commits idempotency/audit/outbox changes together. For multi-unit operations, acquire rows in deterministic unit-ID order to reduce deadlocks. Retry aborted transactions using the same logical keys; never repeat an external payment inside a retried database transaction.

| Action             | Required predicate                                                                                                                                               | Atomic effect                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reserve            | Unit ID and `status = AVAILABLE`; authenticated session and store scope. The paper's initial reserve UPDATE does not require a client version.                   | New unpredictable reservation ID and owner; `reserved_until = database_now + bounded TTL`; version + 1. Return version/deadline.                                                                             |
| Release            | `status = RESERVED`, matching reservation ID, owning session and expected version; `checkout_order_id IS NULL OR checkout_protected_until <= database_now`.      | AVAILABLE, clear reservation/owner/lease/protection, version + 1. A shopper removal cannot release a protected checkout.                                                                                     |
| Expire             | `status = RESERVED`, `reserved_until <= database_now`, and absent/expired checkout protection.                                                                   | Select bounded batches with `FOR UPDATE SKIP LOCKED`, recheck predicates, clear fields, AVAILABLE, version + 1. Parallel workers claim disjoint rows.                                                        |
| Prepare checkout   | For **every** unit: RESERVED, reservation ID, owner session and expected version match; `checkout_order_id IS NULL OR checkout_protected_until <= database_now`. | Create/load order idempotently; bind units to order with bounded payment protection, version + 1; save each returned version in `order_unit`. Any failed unit rolls back all bindings and order writes.      |
| Finalize paid sale | Order has authenticated successful payment; for **every** unit: RESERVED, matching reservation ID, matching checkout order ID and exact protected version.       | One transaction sells all units, records immutable unit/epoch sales, clears reservation/protection, version + 1, marks order COMPLETED and writes outbox events. Any failed unit rolls back the entire sale. |
| Return             | Authorized staff role/store; SOLD, matching original sold order and expected version.                                                                            | AVAILABLE, clear sold/reservation/protection fields; sale epoch + 1 and version + 1; retain immutable sale history and record return. Financial refund is a separate auditable saga.                         |

Paper-specific edge cases:

- Checkout preparation does not explicitly require an unexpired reservation. F5 expressly allows checkout and expiry to race just after reservation expiry; either may win, exclusively. Requiring a live reservation is a reasonable stricter policy, but document that extension.
- Successful payment may finalize after protection expires **if the reservation, binding and version remain unchanged**. Finalization deliberately has no wall-clock deadline predicate. Expiry/rebinding that won first changes the fields/version and forces compensation.
- A new order cannot overwrite an actively protected binding, even for the same owner holding the latest version. Retry an existing order via its idempotency record, rather than rerunning preparation against already incremented versions.
- Reclamation is conditional liveness: the database and a worker must keep progressing. Worker downtime may delay availability. Direct reclaim-on-reserve is mentioned as an optional extension, not part of the listed reserve UPDATE.
- Do not hold a transaction open while talking to payment, SMS, or an AI provider. Database `now()` is transaction-stable; keep lease transactions short and use one explicit database timestamp consistently.

## Idempotency, payment recovery and outbox

1. Require an idempotency key for reserve and order creation; use it for release, return and other side-effecting operations as a stronger API policy. Scope unique keys by authenticated principal/tenant and operation. Hash the validated canonical request, including versions and unit IDs; key reuse with a different request is a conflict.
2. In the **same transaction**, insert the unique key first using `ON CONFLICT DO NOTHING`. The unique constraint serializes duplicates. A duplicate reads the stored status/body after the winner commits; a new call performs the conditional mutation and stores its response before commit. Do not commit an unfinished key separately from the mutation. Paper API: 201 new reservation, 200 replay, 409 unavailable; expose stale/protected conflicts clearly.
3. Commit order preparation before initiating payment. Persist a payment attempt and use a stable provider idempotency identifier derived from the order, including after timeouts/crashes. An unknown outcome requires provider lookup/reconciliation, not a new charge identifier. Provider guarantees and retention windows must be documented.
4. Verify callback signature against the raw request bytes and enforce provider timestamp/replay policy. Check payment identifier, order, amount and currency against the persisted attempt. Uniquely deduplicate provider event IDs and apply monotonic state changes in the same transaction. Distinct events about the same payment must also be semantically idempotent; an old failure must not undo success.
5. Persist PAID even if sale finalization is temporarily unavailable. A reconciliation worker retries known payments/finalization. If units have irreversibly moved on, transition to REFUND_PENDING and perform an idempotent refund with a stable refund identifier; resolve to REFUNDED only from provider evidence. Unknown refund outcomes remain retryable/manual-review cases. No second charge is allowed to repair a failed sale.
6. Insert durable outbox events in the transaction that changes domain state. Publishers claim jobs with bounded leases, retry with backoff and preserve attempt/error visibility. A crash after delivery but before marking delivered can duplicate publication: guarantee **at least once**, with stable event IDs and idempotent consumers, not universal exactly-once delivery. Stock projections/receipts/SMS must tolerate duplicates and lag.
7. Report payment failure in the order resource (`PAYMENT_FAILED`), not HTTP 402. A development payment simulator and a test HMAC webhook are useful harnesses but cannot be described as integrated production payment processing.

## Legacy defects found

| Severity | Evidence                                                                     | Failure and required repair                                                                                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | `app/api/customer/checkout/route.ts:125`, `:157`                             | Client supplies arbitrary discount; every method except `pay_at_desk` is marked completed without a payment provider. Reject arbitrary payment methods, recompute money server-side, and require authenticated settlement evidence.                                                                                           |
| Critical | Checkout `:62`; OTP verify route                                             | Any historical verified row for a phone authorizes checkout indefinitely; no authenticated customer session, expiry/checkout binding or one-time authorization. Another caller who knows a previously verified phone can place orders. Issue a real scoped session after atomic OTP consumption.                              |
| Critical | Checkout stock checks/decrements; `app/api/store/orders/approve/route.ts:78` | Read/check/write stock is non-atomic, orders/items/status/stock/coupon writes are separate commits, and desk approvals race. Can oversell, decrement twice or leave partial orders. Replace with the complete unit transaction protocol.                                                                                      |
| High     | All original SQL migrations/routes                                           | No inventory unit state/version/owner/lease, order-unit protection, idempotency table, payment attempts/events, immutable sales epochs, outbox or reconciliation. Serialized-looking `custom_id` product rows do not implement reservation correctness.                                                                       |
| High     | Checkout cart validation                                                     | Quantities lack positive-integer/type/size validation; negative quantities can add stock and manipulate totals. Duplicate items and empty carts are not reliably rejected. Use strict schemas and unique unit IDs.                                                                                                            |
| High     | OTP send/verify routes                                                       | `Math.random()` OTPs stored in plaintext; no send/attempt throttles or session binding. Read-then-update verification permits simultaneous success. Use cryptographic OTP generation, hashed codes, bounded attempts/cooldown and one conditional consume.                                                                    |
| High     | `app/api/store/auth/signup/route.ts:80`                                      | Unauthenticated GET lists every store's email, approval status and timestamps. Restrict to authorized admin; public store discovery should expose only approved public profile fields.                                                                                                                                        |
| High     | `scripts/02-seed-data.sql`, `04-update-admin.sql`                            | Hard-coded admin identity, documented password and weak deterministic hash; repeated seed overwrites credentials. Remove fixed production credentials; provision admin explicitly using a password KDF.                                                                                                                       |
| High     | `lib/pending-stores.ts`                                                      | Exported pending-store structure stores plaintext password in process-global memory. State is volatile and not shared between processes. Remove fallback and use durable hashed credentials.                                                                                                                                  |
| High     | Schema creation throughout request handlers                                  | Different first-writer CREATE TABLE variants omit foreign keys/columns; CREATE IF NOT EXISTS does not reconcile differences. Swallowed DDL errors obscure broken schema. Use versioned migrations outside request handling.                                                                                                   |
| Medium   | Store products POST/PATCH and bulk upload                                    | Check-then-insert custom IDs have no unique constraint; only the first generated ID is checked. Bulk creation is partial, quantity/price are unbounded, negative prices allowed; CSV parser drops literal quotes and cannot handle multiline quoted cells. Validate staged CSV with a real parser and bounded atomic imports. |
| Medium   | Coupon apply/checkout                                                        | Client amount determines coupon response, `valid_from` is ignored, zero limit/cap treated as absent; checkout never validates the supplied coupon/discount and increments usage non-atomically. Validate and consume limits transactionally using server totals.                                                              |
| Medium   | `lib/db.ts:193`, signup helper `:150`                                        | Login trims passwords while signup hashes untrimmed input; valid passwords containing surrounding spaces fail. Duplicate store insertion silently does nothing but signup reports success. Preserve password bytes and return duplicate conflicts.                                                                            |
| Medium   | `lib/auth.ts`, authenticated API routes                                      | Signed cookies and timing-safe HMAC are present, but sessions are stateless for seven days with no server revocation/account-status recheck. Denied stores may retain privileges until expiry. Add durable revocation/session lookup and current approval checks.                                                             |
| Medium   | `lib/security.ts`, assorted mutation routes                                  | Origin check allows missing Origin, is absent on several mutations, and has no CSRF token. It rejects present origins if configuration is missing. Enforce a coherent same-origin/CSRF policy with validated deployment origin.                                                                                               |
| Medium   | Setup/debug routes, error responses and SMS logging                          | Setup/debug already have token/admin/production gates; do not misreport them as fully public. They still increase operational attack surface. Remove production HTTP schema setup/debug, avoid raw database/provider errors and full phone logging.                                                                           |
| Medium   | Seed SQL and historical models                                               | DEMO001 products reference a store the scripts never create; fixed numeric customer/product references assume sequence state. Product deletion can fail under original FKs or orphan history under request-created schemas. Use coherent seeds and immutable snapshots/history-safe archival.                                 |
| Low      | Order listing; receipt route; `lib/sms.ts`                                   | Unpaginated N+1 order queries; bearer bill links lack revocation and referrer policy; phone normalization checks `startsWith('+')` only after removing '+'. Preserve receipt authorization/output escaping while improving paging, link controls and phone parsing.                                                           |

Existing useful controls should be retained in the new architecture: parameterized SQL, salted scrypt for new password hashes with legacy upgrade, signed role-specific cookies, explicit production setup/debug gates, signed bill links, HTML escaping and `Cache-Control: no-store` for bills. This audit does not claim all old code was insecure.

## Security and AI boundaries

Use an HTTPS identity URI as a lookup key, not proof of product authenticity or authorization. Static NFC/QR identifiers are copyable. Do not claim NTAG424 authentication unless real per-tag keys, cryptographic verification and durable monotonically checked read counters are implemented. NDEF origin validation, tamper-evident attachment and fulfillment checks remain necessary. Ordinary browser URI opening is the portable path; Web NFC availability must be feature-detected, with QR/manual fallback. An offline scan cannot reserve authoritative inventory.

Use role/store/customer authorization on every resource and predicate; bounded body/import limits, strict schemas, abuse controls, secure HttpOnly SameSite cookies, CSRF checks, CSP/HSTS, audit trails, secret redaction and retention policy. No hard-coded production credentials or silent fallback to a volatile database. A process-local demo adapter must be explicitly labeled and disabled for production/multi-process correctness claims.

AI is outside the inventory and payment trust boundary. Recommendations, catalog search, shopping explanations and operations summaries may consume authorized read models; model output must never establish prices, ownership, availability, payment success or direct SQL. Validate structured output, constrain catalog IDs, limit request/time/token budgets, protect tenant data and treat catalog text as untrusted. Explain a deterministic local fallback honestly when no provider is configured; do not label a keyword matcher as a live LLM. Real provider connectivity, evaluation, data handling and cost require separate verification.

## Missing artifacts and realistic limits

At audit time, repository enumeration found none of `nfc_results.tex`, `nfc_tla.tex`, a TLA+ model/configuration, TLC outputs/counterexamples, benchmark harness (`bench.py` / `make_tables.py`), raw results, fault-injection harness, or NFC field-test server/control/analysis kit. The paper inputs the two absent TeX files, so it is not self-contained/buildable as supplied. No public artifact URL is supplied; the manuscript retains an author TODO. The eleven fault scenarios are referenced via absent `\\FaultRows`, so their complete original definitions cannot be recovered from the manuscript alone.

This rebuild adds independently authored field collection/analysis, NDEF sizing and PostgreSQL contention tools under `research/`. They are not the missing original artifacts.

New implementation tests can establish local behavior but cannot reproduce absent original experimental artifacts. In particular, do not claim the paper's state counts, throughput factors, round counts, real NFC hardware reliability, tested authenticated tags, encoder performance, user-study results, or production payment/AI integrations. The single-unit exhaustive and stopped two-unit model results have different evidence strengths. Physical tag/product binding and sensor-free theft detection remain outside database guarantees.

Production readiness additionally depends on an actual PostgreSQL deployment, migration/backup/restore procedure, provider credentials and webhook configuration, durable workers and scheduling, monitoring, TLS/origin/session-secret configuration, load/abuse testing, and verified operational recovery. A clean build and simulated payment test are not evidence that these external conditions have been completed.

## Files read in full

32 source files, plus `package.json` for framework/dependency context:

```text
nfc.tex (1–1070)
scripts/01-create-tables.sql
scripts/02-seed-data.sql
scripts/03-customer-tables.sql
scripts/04-update-admin.sql
lib/auth.ts
lib/db.ts
lib/pending-stores.ts
lib/security.ts
lib/sms.ts
lib/utils.ts
app/api/admin/approve-store/route.ts
app/api/admin/auth/login/route.ts
app/api/admin/auth/logout/route.ts
app/api/admin/setup-db/route.ts
app/api/admin/setup/route.ts
app/api/customer/bill/[orderId]/route.ts
app/api/customer/checkout/route.ts
app/api/customer/coupon/apply/route.ts
app/api/customer/otp/send/route.ts
app/api/customer/otp/verify/route.ts
app/api/customer/product/route.ts
app/api/store/auth/debug/route.ts
app/api/store/auth/login/route.ts
app/api/store/auth/logout/route.ts
app/api/store/auth/session/route.ts
app/api/store/auth/signup/route.ts
app/api/store/orders/approve/route.ts
app/api/store/orders/route.ts
app/api/store/products/bulk-upload/route.ts
app/api/store/products/route.ts
app/admin/session/route.ts
package.json
```
