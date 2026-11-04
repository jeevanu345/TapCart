# Operating TapCart

## Startup and deployment

Use a supported Node.js 22+ release and PostgreSQL 16+. Run versioned migrations explicitly before starting the application; a database advisory transaction lock serializes migration runners. Test migrations/restores on a copied database before production. The app does not run runtime DDL or automatically seed production.

Configure one authoritative database, HTTPS APP_ORIGIN and a reverse proxy with TLS. The Secure session cookie deliberately does not work over plain HTTP in production. Set the proxy trust configuration only for the actual deployment topology before relying on forwarded IPs for rate limits. Default rate limiting is per-process; a multi-instance deployment requires shared ingress limits. Browser/API are same-origin; arbitrary CORS origins are not enabled.

Do not enable the development payment simulator or seed in production. Bootstrap the first administrator via operator environment variables and remove those variables afterwards. Register and approve stores, and grant database credentials least privileges for the application after schema migration.

## Workers and recovery

Expiry batches and paid-order finalization run every five seconds; external provider reconciliation runs every minute. Expiry batches and use FOR UPDATE SKIP LOCKED to coordinate multiple workers. Reconciliation retries persisted paid orders without charging again. If protected inventory was legitimately lost, the order requires a refund. Workers are hosted by the always-running Node process; monitor them and avoid scale-to-zero. The default outbox consumer commits an event-ID-deduplicated delivery journal for the administrator event feed. External delivery is not configured; adding a broker requires durable claims, retries, event-ID deduplication and alerts.

An unknown external charge outcome must be looked up using the same stable order/provider key. Never retry by creating a second order to repair payment uncertainty. Desk payment confirmation means a staff member physically received the amount. Refund confirmation means funds were actually returned; the UI/database record is not a money transfer. Card refunds use the documented provider workflow and cannot be recorded as cash.

## Monitoring

Check GET /api/health for database connectivity, application process restarts, database pool saturation/locks, 5xx/conflict/error rates, expired unprotected lease backlog, old PAYMENT_PENDING/PAID/REFUND_PENDING orders, failed callbacks and pending outbox records. Distinguish expected 409 races from service faults. Keep operational logs free of passwords, session tokens, card details, full webhook payloads and unnecessary customer personal data. Retain audit/payment evidence according to your deployment's documented policy.

Request/collection limits bound queries and body/import sizes. Listing endpoints have caps; large catalogs require explicit paginated reporting rather than assuming the first 1,000 products/units or 250 orders are a full export. Server CSV export reads the authorized dataset; keep large exports behind resource limits and introduce streaming/background jobs as volume warrants.

## Backups and incident response

Enable encrypted PostgreSQL backups/PITR and test restore regularly. Record recovery objectives and an owner. During an incident, stop new checkout if authoritative database availability is uncertain. Restore inventory, orders, idempotency keys, payment events, provider mappings and outbox together. Reconcile actual provider payments against restored orders before resuming sales. A database backup alone cannot rewind a real charge.

Rotate compromised session credentials by expiring server-side sessions. Keep sessions referenced by order/audit history or anonymize them according to a migration/retention plan rather than deleting foreign-key evidence. Password resets and account recovery require an authenticated operator workflow; do not expose an unauthenticated setup/debug endpoint.

## NFC operations

Write one HTTPS URI per individual unit. Read back and compare each tag to the manifest before locking/attaching. Audit swaps and physical fulfillment; static tags can be copied. Unsupported browsers can open standard NFC URLs or paste unit links. Without backend connectivity a scan cannot create an authoritative reservation. Hardware read tests and provisioning throughput are separate from database correctness.

## Intelligence

Local statistics require historical observations; seeded data must never be reported as real trading performance. Review the confidence/evidence and supplier constraints before replenishing. Optional Ollama is loopback-only, read-only and receives aggregate/catalog data without customer personal details. Model failures fall back to local evidence; no decision automatically updates stock or payments.
