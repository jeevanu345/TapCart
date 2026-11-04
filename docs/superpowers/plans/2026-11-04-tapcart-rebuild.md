# TapCart implementation plan

**Goal:** Implement the supplied transactional NFC paper and a usable retail product in React, Node.js and TypeScript, removing Next.js.

**Architecture:** Vite serves the React SPA in development; Express serves the built SPA and JSON API in production. PostgreSQL is authoritative for physical units, sessions, reservations, orders, idempotency, payment events and outbox records. Statistical intelligence runs locally, with an optional local language model.

**Spec:** `nfc.tex`, `docs/research-audit.md`, `docs/ui-audit.md`.

## Scope and decisions

- Preserve TapCart branding. Use INR integer minor units for money and serialize individual inventory units.
- Preserve existing data by leaving old databases untouched; provide an explicit legacy migration guide rather than destructive conversion.
- Customer, approved store and administrator authorization are enforced server-side.
- Static NFC tags identify units; do not claim cryptographic authenticity or offline reservations.
- No cloud credentials are assumed. Cash desk settlement is real staff confirmation; simulated payments are development-only.
- Never claim to reproduce missing TLA+, benchmark results or physical NFC measurements.

## Deliverables

- [x] Research and legacy audit: read all source, paper and configuration; record security and behavioral defects.
- [x] UI: responsive store workspace, inventory editing, serialized tags, orders and returns, customers, insights, customer cart and receipts, admin approvals. Validate states through browser journeys.
- [x] Transaction backend: stronger database CHECK constraints, atomic reservation/release/expiry, checkout binding, payment deduplication, finalization/refund path, sale epochs and outbox. Test with real concurrent PostgreSQL requests.
- [x] Intelligence: evidence-backed demand/reorder forecasts, anomaly signals, association recommendations and constrained read-only assistant. Verify sparse-data and invalid input behavior.
- [x] Integration: shared API conventions, same-origin cookie/CSRF, health/readiness, migrations, development seed, production bootstrap, graceful shutdown.
- [x] Quality: Prettier, ESLint, TypeScript, meaningful API concurrency and browser tests, build, dependency audit, documentation and container deployment.

## Review focus

1. Concurrent reservation and checkout rebind attempts must have exactly one winner.
2. Invalid money, quantity, unit identity and cross-store access must fail without writes.
3. Refresh/retry/lost response must not duplicate charges or sales.
4. Checkout and lease expiry must not free protected units.
5. Unsupported NFC, empty stores, expired sessions and unavailable databases must show actionable UI states.
