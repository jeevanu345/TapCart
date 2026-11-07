# Architecture and evidence

TapCart is a React/TypeScript SPA built with Vite, a TypeScript Express API running on Node.js, and PostgreSQL 16+ as the authoritative store. The production Node process serves the built client and API from one origin. No Next.js runtime or dependency is required.

## Trust boundaries

The client submits unit identifiers, versions, reservation identities and idempotency keys. It never establishes price, discount, available stock, ownership or payment success. Monetary values are integers in INR paise. Each physical inventory unit has one UUIDv7, independent of its SKU. An NFC/QR HTTPS URI opens `/u/{id}`; copied static links are not cryptographic proof that a tag or product is genuine.

Sessions use random 256-bit opaque cookie tokens with only SHA-256 hashes stored server-side, a separate per-session CSRF token, exact-origin checks and role/tenant authorization. Passwords use salted scrypt. Store registration requires administrator approval. Production uses Secure/HttpOnly/SameSite cookies, Helmet/CSP and an explicit HTTPS origin.

## Protocol

Unit state is AVAILABLE → RESERVED → SOLD; release/expiry returns a reservation to AVAILABLE. Authorized return is the only exit from SOLD and increments sale epoch. Every transition increments the unit version. Database CHECK constraints reject inconsistent field combinations. Inventory counts are derived from unit state.

Scoped idempotency keys and canonical request hashes commit with their result in the same transaction. All order units are protected atomically in deterministic ID order before payment. An active checkout cannot be rebound. Finalization requires the exact reservation, owning session, order binding, sale epoch and protected version. `(unit_id, sale_epoch)` uniquely records a sale. Payment has its own state machine, and late success without recoverable inventory enters refund review.

This rebuild deliberately requires a still-live reservation when preparing checkout and an expected version when reserving an available unit: stricter policies than the manuscript's minimal SQL. Finalization itself can succeed after a protection deadline if no intervening transition changed the binding/version. Inventory expiry and paid-order reconciliation run every five seconds; provider payment/refund reconciliation runs every minute; PostgreSQL SKIP LOCKED coordinates expiry batches. Workers require a continuously running Node service; scale-to-zero platforms require an always-running worker deployment.

Events enter the outbox in the domain transaction. The default local consumer atomically inserts an event-ID-deduplicated delivery journal in PostgreSQL for the authorized event feed. This is not proof of delivery to an external broker. External delivery requires a real consumer with stable event IDs, acknowledgments, retries and monitoring; publication is at-least-once when such a consumer is used.

## Intelligence and operations

`server/intelligence/` owns local sentence embeddings, worker-isolated PDF/OCR extraction, rolling-origin replenishment models, anomaly evidence and a bounded multilingual read-only assistant. `server/commerce/` owns supplier receiving and integer-paise coupon allocation; checkout persists per-unit paid amounts for exact refunds. `server/security/` owns one-use account tokens and encrypted TOTP enrollment, while `server/notifications/` delivers the transactional queue. Worker shutdown drains notification acknowledgments before closing PostgreSQL. Routes enforce tenant/role checks and all mutations use CSRF protection. Detailed contracts and deployment limits are in [intelligence](intelligence.md), [commerce](commerce.md), [security](security.md) and [NFC](nfc.md).

## Source references consulted

- Supplied manuscript: `nfc.tex`, fully audited in `research-audit.md`.
- [PostgreSQL 16 transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html): concurrent UPDATE predicate re-evaluation.
- [node-postgres transactions](https://node-postgres.com/features/transactions): one connected client per transaction.
- [Express production security](https://expressjs.com/en/advanced/best-practice-security/): input validation, TLS, headers and cookies.
- [Vite guide](https://vite.dev/guide/): React SPA tooling and supported Node versions.
- [Chrome Web NFC](https://developer.chrome.com/docs/capabilities/nfc): secure-context, user-gesture and browser limitations.
- [Stripe webhook operations](https://docs.stripe.com/events/manage-webhook-endpoints): raw-body signatures, deduplication and recovery.

## Limits of verification

Automated tests establish behavior of this implementation on the tested PostgreSQL/runtime/browser combination. They do not reproduce missing TLA+ artifacts or original raw paper measurements. Real tag read reliability, authenticated NTAG424 hardware, provisioning/attachment quality, live payment credentials, optional Ollama model quality, deployment infrastructure, backup restoration and production load require their own operational validation. New measurement tools live in `research/` and label their provenance explicitly.
