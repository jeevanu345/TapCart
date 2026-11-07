# TapCart

**Tap. Shop. Go.** Transactional NFC shopping and store operations, implemented in **Node.js, React and TypeScript**. Vite builds the client; Express runs the API; PostgreSQL owns inventory and transactions. No Next.js.

The supplied [research manuscript](nfc.tex) drives the per-unit reservation protocol. Read [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), the [research audit](docs/research-audit.md), [UI audit](docs/ui-audit.md), [architecture](docs/architecture.md) and [migration guide](docs/legacy-migration.md) for the design, defects replaced, evidence and limits.

## What works

- Public landing page, white and black themes, command palette (⌘K), notifications and a setup checklist.
- Workspace plans with enforced product, unit and seat limits. Stores request a plan and an administrator applies it. **Online billing is not connected, and the listed prices in `server/plans.ts` are placeholders to confirm before launch.**
- Team seats with manager and staff roles and single-use invitation links. TapCart does not send email, so the link is shared by hand.
- Store settings with a configurable low-stock threshold, account profile and password change that ends other sessions.
- Desk mode with a live payment queue and unit lookup, per-unit history, printable QR labels, an activity log and period reports with CSV export.
- Responsive retailer workspace with live revenue charts, stock health, searchable inventory, product creation/editing/archiving, serialized stock receipts, atomic CSV imports and exports.
- NFC tag studio with one UUIDv7 URI per physical unit, selection, copy/open links and provisioning manifests. Native Web NFC is optional; normal NFC URI launch and manual links work without it.
- Authenticated shopper catalog, exact-unit reservation, server-persisted cart, visible leases, protected checkout, desk settlement, development payment simulation, order status and authorized printable receipts.
- Optional Stripe hosted card payments with server-created sessions and signed webhooks. See [Stripe setup and verification](docs/stripe.md). No payment succeeds from a browser redirect alone.
- Store registration/administrator approval, scoped roles, authenticated sessions, CSRF protection, input validation and audit events.
- Conditional atomic reservations/releases/expiry; monotonic versions; checkout rebinding protection; scoped durable idempotency; per-sale epochs; returns/refund accounting; payment recovery and outbox records.
- Local demand/reorder estimates, demand shifts, basket associations and an evidence-backed assistant. Optional Ollama language model; no paid AI key is required for local statistical mode.
- Reproducible NFC/QR field collection/analysis, Wilson intervals, NDEF byte sizing and a real PostgreSQL contention probe in [research/](research/README.md).

## Expanded operations and intelligence

- Account recovery, verified email, authenticator MFA and one-use recovery codes; durable SMTP delivery with retries and a development capture inbox. [Security setup](docs/security.md).
- Suppliers, reviewed purchase drafts, partial receiving with cost snapshots, server-priced coupons and payment reconciliation. [Commerce guide](docs/commerce.md).
- Supplier-aware replenishment and rolling backtests, local invoice OCR with staff review, semantic catalog search, human-reviewed anomaly alerts and an English/Hindi/Kannada assistant with evidence. [Intelligence setup and limits](docs/intelligence.md).
- Browser NFC encoding/read-back, authenticated NTAG424 SDM support, independent bounded TLA+ checks, expanded PostgreSQL fault scenarios and hardware trial instrumentation. [NFC guide](docs/nfc.md), [actual formal results](research/formal/README.md).

Initial local AI setup: `npm run ai:models`. SMTP credentials and NFC hardware/personalization are required to validate real delivery and physical tags. Software tests do not substitute for those checks.

## Start locally

Requires Node.js **22.13+**, npm and PostgreSQL **16+**. Never use the same database for production and tests.

```sh
npm ci
cp .env.example .env
# macOS/Homebrew helper; otherwise create equivalent databases in PostgreSQL:
npm run db:local
npm run db:migrate
ALLOW_DEVELOPMENT_SEED=true npm run db:seed
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001. Vite proxies `/api`; browser and API are same-origin. If port 3001 is occupied by another project, use `PORT=3002 npm run dev`; Vite follows the same API port override. Use the exact configured APP_ORIGIN, including host and port, for CSRF. Changing localhost to 127.0.0.1 changes the origin.

The development seed is explicit, refused in production, idempotent on a populated database, and includes labeled simulated historical orders so charts/forecasts can be exercised. Demo password: **TapCartDemo123!**.

| Role          | Development email     |
| ------------- | --------------------- |
| Store         | store@tapcart.local   |
| Shopper       | shopper@tapcart.local |
| Administrator | admin@tapcart.local   |
| Pending store | pending@tapcart.local |

Use separate browser profiles or private windows to exercise shopper and store roles at the same time. In Tag studio, open/copy an available unit link, sign in as a shopper, reserve it, then checkout. A desk order remains PAYMENT_PENDING until staff actually collect and confirm payment.

`.env.example` documents configuration. Development simulation requires ALLOW_DEVELOPMENT_PAYMENTS=true and is refused in production. Demo credentials and historical fixtures are not production account setup.

## Quality checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

`npm test` loads `.env` and requires TEST_DATABASE_URL for protocol integration tests. Tests reset a **disposable database whose name includes test**. Browser tests use the same disposable database sequentially, reseed it and serve the built app on 127.0.0.1:4173. Build before running them. Locally Playwright uses installed Google Chrome; CI installs Chromium. Do not run API and browser test suites concurrently on one database.

Pure intelligence/research tests can run separately with `npm test -- server/intelligence.test.ts research/research.test.ts`. CI runs formatting, lint, types, real PostgreSQL tests, production build and browser journeys. See [verification record](docs/verification.md) for actual results from this rebuild.

## Structure

```text
client/src/       React routes, operations UI, shopper flow, primitives and CSS
server/           Node API, auth, transactions, intelligence, payments and workers
server/migrations/ Versioned PostgreSQL schema
server/scripts/   Explicit migrations, development seed and first-admin setup
server/tests/     Real PostgreSQL protocol/security tests
research/         Independent measurement tools and their tests
e2e/              Browser journeys and isolated test-server setup
docs/             Audits, API/design rationale, migration and operations
```

The API is `/api`; `GET /api/health` checks database connectivity. Authenticated mutations require the session CSRF token, exact Origin and, for transactional operations, an Idempotency-Key. Prices are integer INR paise internally. Client totals are display-only.

## Production deployment

```sh
npm ci
npm run build
# Configure DATABASE_URL, NODE_ENV=production, HTTPS APP_ORIGIN first.
node --env-file=.env dist/server/scripts/migrate.js
# Set ADMIN_EMAIL, ADMIN_PASSWORD (14+ characters), optional ADMIN_NAME securely:
node --env-file=.env dist/server/scripts/create-admin.js
npm start
```

Serve TLS through your reverse proxy/load balancer and forward to port 3001. Set ALLOW_DEVELOPMENT_PAYMENTS=false and omit development seed flags/accounts. The Node service serves `dist/client` and runs expiry/reconciliation workers. Run it continuously; workers must not scale to zero while reservations need reclamation. Configure provider credentials/webhooks only when enabling real card payments. No live provider account is required for cash desk operation.

A multi-stage non-root Docker image and `compose.yaml` are included. Set a unique POSTGRES_PASSWORD and production environment, start `docker compose up -d db`, build the app, then run `docker compose run --rm app node dist/server/scripts/migrate.js` and the administrator bootstrap before `docker compose up -d app`. Do not publish the database port. Use secrets management for credentials, not committed environment files.

Read [operations](docs/operations.md) for backups, recovery, security and observability. Existing installations require the explicit [legacy cutover](docs/legacy-migration.md); old SKU links and unverifiable payment history are not silently imported.

## Evidence boundaries

This code implements and tests the manuscript's transaction design with documented stricter lease/version checks. The original TLA+ model, generated TeX tables, raw benchmark data and counterexamples are absent; this project does not claim to reproduce those results. New local tests and harnesses establish only their measured behavior.

Static NFC tags identify a record; they do not authenticate physical goods. Actual phone/tag/material reliability and user studies require hardware measurements. Stripe live settlement, optional Ollama quality and deployed infrastructure require their own credentials and operational verification. SMS is not implemented. SMTP delivery and a restricted NTAG424 SDM profile are implemented, with real email-provider and physical tag validation still required for deployment. Forecasts are observational estimates; no accuracy guarantee is implied.

Proprietary / internal use. See [LICENSE](LICENSE).
