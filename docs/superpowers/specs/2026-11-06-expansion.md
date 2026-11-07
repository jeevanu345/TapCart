# TapCart operational and research expansion

The user selected the proposed functionality and requested immediate end-to-end execution. Extend the current Node.js / React / TypeScript / PostgreSQL system; preserve its monochrome design and existing workflows.

## Deliverables and boundaries

1. Recovery and MFA: hashed one-use recovery/verification tokens, bounded challenges, TOTP enrollment/recovery, session revocation and role-aware settings.
2. Delivery: durable email queue with real SMTP, authenticated development capture, retries and truthful states. Real email needs operator SMTP configuration.
3. Purchasing: suppliers, lead times, purchase orders, drafts and atomic partial receiving with immutable costs and idempotency.
4. Promotions: server-calculated amounts, bounded coupon usage under concurrency, immutable discounted item allocation, refund correctness.
5. Reconciliation: authorized payment/refund exceptions with server-authenticated provider retries; never client assertion of paid/refunded.
6. Intelligence: lead-time/weekday-aware forecasting selected via rolling backtests; local invoice text/PDF/image extraction to editable reviewed drafts; semantic retrieval with deterministic constrained fallback and optional local embeddings; explicit read-only anomaly triage; multilingual grounded answers with evidence.
7. NFC: physical write/read-back workflow with honest observation records, deliberate optional irreversible lock, documented authenticated NTAG424 profile and atomic replay counters, provisioning and field measurement UI.
8. Research: independently authored bounded TLA+ model, actual TLC outputs and guard-negative controls, expanded executable fault tests and instrumented field collection. Do not fabricate original paper results or hardware measurements.

## Architecture decisions

Use modular routes registered by app.ts, versioned migrations 006 security/007 commerce/008 NFC/009 intelligence, existing role/store authorization and existing UI primitives. All external calls occur outside inventory transactions. Invoice extraction and AI never mutate inventory or settle payments. Accepted drafts and receipts require staff review and durable idempotency. Secrets are operator-provided environment variables; local tests must not reset the working application database.

Integration points: MFA password login challenge before createSession; coupon calculation and claim inside checkout's idempotent transaction with item-price snapshots; authenticated tag counter inside reservation transaction after idempotency claim; notification delivery from stable committed events; workers stop cleanly on shutdown.

## Acceptance

Real PostgreSQL concurrency/authorization/one-use tests; local document extraction and forecasts evaluated without leakage; fixture-based cryptographic vectors; TLC actual bounded results and negative controls; browser flows for recovery, procurement/coupons/reconciliation, AI and NFC unsupported-device states; formatting/lint/types/build; no source upload to third-party review services. External SMTP delivery, live payment settlement and physical NFC testing are documented separately unless actually exercised.
