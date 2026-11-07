# TapCart expansion implementation plan

**Goal:** Deliver all requested AI, operational, security and research/NFC features with concrete verification.
**Architecture:** Existing React/Vite + Express + PostgreSQL, split into independent modules with integration at transaction boundaries.
**Spec:** docs/superpowers/specs/2026-11-06-expansion.md

- [x] Security/delivery: migration006, services/routes/UI, one-use token/MFA/queue tests and login/event integration.
- [x] Commerce: migration007, suppliers/orders/drafts/receipts, coupon allocator/claim, reconciliation routes/UI and race tests.
- [x] NFC/research: migration008, encode/read-back UI and observations, real SDM verification/replay guard, bounded model+TLC artifacts and fault suite.
- [x] Intelligence: migration009, forecast/backtest/replenishment models, document extraction/approval draft, semantic search, anomaly review and multilingual grounded assistant.
- [x] Integrate transaction hooks, routes/navigation, worker lifecycle, env setup and documentation.
- [x] Run isolated database tests, formal checks, browser journeys/accessibility, dependency audit, format/lint/types/build. Record actual outcomes and unresolved external validation.

Verification details and external validation boundaries: [docs/verification.md](../../verification.md). No physical NFC measurements, live payment settlement or public deployment are claimed.
