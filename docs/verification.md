# Verification record

## Shared menus and focused forms, 7 November 2026

Every visible select across inventory, tags, orders, purchasing, coupons, intelligence, team settings and shopper browsing now uses the same monochrome Radix Select surface. Category suggestions use a matching editable popover. Hidden native controls retain submission, required-field validation, disabled omission and reset behavior. Background controls are inert while a menu is open, including inside dialogs; closing restores focus. The shared primitive is based on [Radix Select](https://www.radix-ui.com/primitives/docs/components/select); explicit inert handling also addresses the background-focus issue described in [Radix issue 1927](https://github.com/radix-ui/primitives/issues/1927).

NFC tools now separate Encode, Authenticated tags and Field testing into keyboard-accessible tabs. Advanced hardware details use disclosures. Account security uses a bounded content column, consistent status badges and clear spacing between explanatory text, fields and actions. Desktop and 390px mobile light/dark screenshots were inspected locally without starting hardware trials or changing live MFA settings.

Final local checks: `AI_REQUIRE_MODELS=true npm run check` passed formatting, lint, all TypeScript configurations, **138 tests across 17 files**, and the production build. `npm run test:e2e` passed **14 Chrome journeys**. The new menu journey verifies arrows/Home/End, selection, Escape, focus return, required validation, editable categories, dialog nesting, mobile popup bounds and an open-menu WCAG 2 A/AA axe scan with no reported violations. Component tests additionally verify native form values, resets, canceled resets, disabled omission and asynchronously loaded options. Production dependency audit reported zero known vulnerabilities; `git diff --check` passed. These checks do not establish physical NFC compatibility or a complete accessibility certification.

## Selective corner refinement, 7 November 2026

Replaced the universal square-corner reset with shared 4/8/12/16px radius tokens and circular/pill shapes where they convey control or status. Buttons, forms, panels, menus, product images and dialogs now soften consistently. Radio controls are circles, checkboxes use ticks, attention markers keep diamonds, and tables, receipts and printed QR labels keep straight edges. NFC actions now use the shared Button primitive. DESIGN.md records the updated policy.

Verified in the live browser: dark desktop overview, dark mobile product form sheet (390px), and light desktop shopper catalog. Computed radii match the component roles; no horizontal page overflow was observed. Lint, typecheck, production build, eight NFC component tests and all thirteen browser journeys passed, including existing keyboard, mobile and accessibility checks. Component tests now use the same automatic JSX runtime as the app.

## Operational, intelligence and NFC expansion, 7 November 2026

Verified locally with Node.js 26.7.0, PostgreSQL 16 and installed Chrome. The supported Node floor is now 22.13 for the installed PDF.js release. All database tests used the separate test database or isolated temporary schemas. The populated development database was not truncated.

| Check                                                  | Observed result                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_REQUIRE_MODELS=true npm run check`                 | Format, ESLint, all three TypeScript configs, 130 tests across 16 files, and production build passed.                                                                                                                                                                            |
| `npm run test:e2e`                                     | 13 browser journeys passed, including supplier drafts/partial receiving, coupon checkout, reconciliation, real local semantic search for staff/shoppers, grounded Hindi answers, invoice review, NFC unsupported-device behavior, MFA/recovery, mobile layout and accessibility. |
| `npm run ai:models`                                    | Public local embedding/OCR weights installed; real 384-dimension embeddings computed.                                                                                                                                                                                            |
| Local document tests                                   | Actual Tesseract recognition of generated PNG and scanned PDF; actual PDF.js text extraction. Generated fixtures are not real supplier/hardware measurements.                                                                                                                    |
| Compiled worker smoke                                  | Built `dist/server/intelligence/invoices.js` invoked its compiled OCR worker and recognized the expected amount.                                                                                                                                                                 |
| SMTP integration                                       | Actual Nodemailer against a disposable localhost SMTP server: accepted envelope/body, SMTP451 retry and final SMTP550 failure. No external email sent.                                                                                                                           |
| `npm run research:formal` with official TLC2.19/Java21 | Correct bounded model passed nine properties, 119,986 generated/35,279 distinct states/depth15. Five guard-negative controls failed as expected; two others passed within the documented abstraction. Runner assertions passed all eight configurations.                         |
| `npm audit --omit=dev`                                 | Zero known production dependency vulnerabilities at verification time.                                                                                                                                                                                                           |
| `git diff --check`                                     | Passed.                                                                                                                                                                                                                                                                          |

Review findings led to regression tests for password-change/reset races, MFA challenge/session authority, serialized NFC policy changes, notification leases, grouped INR values, source-backed invoice review, image dimension preflight, bounded inference/cache behavior, checkout coupon claims, receiving capacity and authenticated NFC query preservation. The notification worker claims one message at a time and drains the current acknowledgement before database shutdown.

Primary sources and exact contracts are recorded in [security](security.md), [commerce](commerce.md), [intelligence](intelligence.md), [NFC](nfc.md), [formal results](../research/formal/README.md) and [fault evidence](../research/faults/README.md). Chrome DevTools MCP additionally inspected the live local workspace; no application source was uploaded to a third-party review service.

Not established: external SMTP inbox delivery, live Stripe settlement, physical NFC writes/authenticated tags/read reliability, deployed load, backup restoration, a Docker build or a remote CI run. The assistant uses translated evidence-based operational templates; weekday forecasts and historical error buffers are not universal predictions. The authenticated NFC profile is deliberately restricted and needs matching hardware personalization. Newly authored formal/fault artifacts do not reproduce missing original paper artifacts or its claimed measurements.

The older records below are historical and describe their respective implementation dates.

## White-to-black SaaS rebuild, 4 November 2026

`npm run check` passes (format, lint, types, 49 Vitest tests in seven files against real PostgreSQL, production build). `npm run test:e2e` passes six Chrome journeys, including axe WCAG 2 A/AA scans of the landing page, the shopper page and the store workspace in the white and black themes. Production dependency audit reports zero known vulnerabilities. New API tests cover invitation single use, role limits, member removal, plan limits, password change, store scoping of activity and unit history, and the low-stock threshold.

Not established: real email delivery (none exists), subscription billing (not connected), physical NFC reads, and print output on real label stock. Listed plan prices are placeholders.

The record below is from the earlier rebuild.

Verified locally on 4 November 2026 (Asia/Kolkata), Node.js 26.7.0, PostgreSQL 16.13 on macOS/Apple Silicon, installed Google Chrome through Playwright 1.64.1. The supported Node floor is 22.12; CI and the container target Node 22, but those remote/container runs were not performed here.

| Check                                  | Observed result                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                 | All matched files conform to Prettier.                                                                                                                                           |
| `npm run lint`                         | Zero ESLint errors/warnings.                                                                                                                                                     |
| `npm run typecheck`                    | Client, server, research and browser-test types pass.                                                                                                                            |
| `npm test`                             | **42 tests pass in six files**, with a real isolated PostgreSQL database.                                                                                                        |
| `npm run build`                        | React production bundle and compiled Node server build successfully; migrations copied into the server output.                                                                   |
| `npm run test:e2e`                     | **Four Chrome journeys pass** against the built client and an isolated, freshly seeded database.                                                                                 |
| Local axe WCAG 2 A/AA scans            | No violations reported on the tested shopper and retailer overview pages. This is an automated subset, not a full accessibility certification.                                   |
| `npm audit`                            | Zero known vulnerabilities across installed production/development dependencies at the time checked.                                                                             |
| `git diff --check`                     | No whitespace errors.                                                                                                                                                            |
| Compiled Node production-mode smoke    | Health 200/database connected; SPA 200; Secure cookie; simulator disabled; absent card credentials disable card capability; unauthenticated orders 401.                          |
| Disposable PostgreSQL contention probe | Ten clients × three rounds per mode: conditional UPDATE and SELECT FOR UPDATE each report exactly one owner per round; synchronized unsafe control reports ten owners per round. |

The full suite also passed after initializing a fresh disposable database from the final migration files; the final administrator-refund regression passed in that database as part of `npm run check`.

The concurrency probe's [raw output](verification/contention.json) includes runtime/PostgreSQL versions and measured timing. This is a small correctness probe on a disposable table, not the paper's benchmark reproduction or a production throughput claim. The unsafe control deliberately synchronizes stale reads; its latency is not a comparable performance result.

## Behaviors exercised

API tests cover twenty concurrent shoppers, durable idempotency replay and payload mismatch, cross-session/stale release, checkout rebinding, concurrent duplicate checkout, exact sale/return versions and epochs, protected lease expiry, expired unprotected units, late payment recovery/refund obligations, multi-unit rollback, partial refunds, cross-store authorization, pending-store access, public credential redaction, CSRF and production payment gates, transactional CSV import, zero-value returns, calendar-complete reports idempotent stock receiving and administrator refund settlement after store revocation.

Stripe tests use the actual SDK's signature construction and verification, including altered payloads, old signatures, wrong test/live mode and future event times. Only the external provider API is mocked. Real PostgreSQL tests exercise lost checkout/refund responses with stable persisted provider keys, payment identity/amount validation, duplicate callbacks, late paid success, immutable sale history and refund-ledger deduplication. Receipt tests check HTML escaping and server-calculated money. Intelligence tests cover sparse observations, changing demand, bounded replenishment and missing confidence. CSV tests check quoted/multiline round trips and formula injection. Research tests cover Wilson intervals, measurement parsing and NDEF size/capacity.

Browser journeys cover retailer login and live charts, product creation with physical stock, grounded assistant response, mobile navigation/table overflow, shopper exact-unit reservation, desk checkout, staff settlement, receipt, administrator approval and new customer registration. Browser page errors are checked on the retailer journey. The local accessibility scan caught and led to correction of low-contrast illustration text; the mobile check caught an absolutely positioned screen-reader label escaping the scroll container. Form labels and signup payload handling were also corrected from actual failures.

Screenshots use explicitly seeded development fixtures:

- [Retailer overview](verification/overview-desktop.png)
- [Mobile inventory](verification/inventory-mobile.png)
- [Receipt](verification/receipt.png)

## Not established by these checks

No public deployment, Docker image build (local Docker daemon unavailable), remote GitHub Actions run, Node 22 runtime run, live Stripe transaction, externally delivered webhook, actual refund settlement, optional Ollama model invocation, physical NFC/NTAG424 validation, real encoder/provisioning test, user study, backup restore or production load/abuse test was performed. These remain deployment/hardware/provider validation tasks, not claims hidden behind passing unit tests. Cash operation and local statistical intelligence require neither Stripe nor Ollama.

The supplied paper's TLA+ model, generated TeX tables and original raw results are missing. New tests/tooling do not substantiate the manuscript's reported state counts or throughput multipliers. The full [audit](research-audit.md) records those boundaries.

Automatic approval review rejected uploading source to the third-party 21st.dev review service. That external review was not used as completion evidence. Local ESLint, browser tests, screenshots and axe checks supplied the UI verification instead. The 21st CLI was used only for the local design inventory; its component search was unavailable (HTTP 401).
