# Store intelligence

The Intelligence lab is available from the store sidebar. All reads are scoped to an approved store; administrators select an approved store explicitly. Staff can search, inspect forecasts and view alerts. Invoice extraction, replenishment policy changes and alert decisions require an owner, manager or administrator. Mutations use the existing origin/CSRF protection and audit journal. No assistant can mutate inventory, accept a payment or approve a purchase.

## Local model setup

```sh
npm run ai:models
AI_REQUIRE_MODELS=true npm test -- server/tests/intelligence.test.ts
```

The setup command downloads the public `Xenova/all-MiniLM-L6-v2` quantized model and English Tesseract language data into ignored `.cache/models` and `.cache/ocr`. It runs real embedding inference before reporting success. Keep these directories on a persistent deployment volume; configure `AI_MODEL_CACHE` and `OCR_MODEL_CACHE` if needed. In a built production image, run `node dist/server/scripts/ai-models.js` during controlled model provisioning. Normal inference does not download models unless `AI_ALLOW_MODEL_DOWNLOAD=true` is explicitly set. Store records and invoice bytes stay on the Node host. An internet connection is needed for initial model installation, not ordinary local inference.

The shopper Browse screen also offers “Search by meaning” after an approved store is selected. Its separately rate-limited public endpoint returns only existing public catalog fields, never supplier costs or operational records.

Catalog search computes normalized sentence embeddings and cosine similarity locally, with exact price filtering before results are returned. Full-catalog embeddings are cached independently of price filters (up to eight store catalogs, 2,000 active products each). Model initialization is shared; inference is serialized rather than queueing unbounded CPU work. Missing/busy models fall back to synonym-expanded lexical search, explicitly labeled `lexical-local`; `semantic-local` is reported only after actual embedding inference. Common INR phrases and Hindi/Kannada product synonyms are supported. This English embedding model is not claimed to be a general multilingual semantic model. Intelligence endpoints have a dedicated per-account rate limit.

## Replenishment and measured backtesting

Each product can inherit an active supplier's lead time, override lead time, choose a review interval and set a minimum stock target. Replenishment subtracts both currently available units and outstanding quantities on open/partial purchase orders. Purchase recommendations are advisory and never place supplier orders automatically.

The system constructs zero-filled daily net-sales histories over up to 180 completed India calendar days, starting at product creation. It excludes incomplete today and returned sales. Candidate methods are a trailing mean, a recency-weighted mean, a shrunk weekday seasonal mean and an intermittent-demand estimate with a bias adjustment. Each rolling origin trains only on earlier observations; held-out sums are evaluated over the planning horizon capped at 14 days. Up to 29 recent origins select the lowest-MAE method. The UI exposes candidate MAE, WAPE, origin count and validation horizon. WAPE is undefined when all validation actuals are zero; sparse histories have no invented accuracy score.

The planning horizon is supplier lead time plus review days. A historical positive-error percentile supplies a buffer scaled to that horizon. This is not a calibrated prediction interval or a promised service level. Backtests retrospectively use the current net-sales ledger, including known returns; they are not immutable forecasts logged at the historical decision time. Stockouts, missing history, promotion effects, annual seasonality and future supplier delays are not observed by this model. Only weekday seasonality is modeled; at most 180 days does not establish yearly effects. Larger horizons extrapolate beyond the displayed validation horizon. New/sparse products should use explicit minimum stock and staff judgment.

## Supplier invoice extraction

Paste text or upload UTF-8 text/CSV, PDF, PNG or JPEG (8 MB maximum, five PDF pages, 16 megapixels for images). Text PDFs use PDF.js; scanned pages and images use actual local Tesseract OCR. Image dimensions are checked before native decoding, rendered PDF surfaces are bounded, CPU work runs in dedicated worker threads, and at most two extractions run per process. Jobs terminate after 60 seconds. V8 limits are not an OS sandbox; deploy document processing with appropriate host/container resource limits.

The parser accepts explicit description/SKU, quantity and INR unit-cost rows. It handles grouped prices and identifies unique exact SKUs or unique name matches. Ambiguous/unmatched products stay unassigned. Each result retains the source line and extraction engine. Staff edit products, quantities and integer-paise costs before creating a receiving draft. Draft creation is idempotent and does not change stock. A separate purchase approval and partial/full receiving operation records physical units and cost snapshots. Invoice totals, tax/GST, discounts, pack-size conversion and arbitrary vendor layouts are not silently inferred; staff must verify them against the original. Raw upload bytes are discarded after extraction; text/results persist for review.

## Operational anomalies

An automatic worker checks approved stores every five minutes, and staff can run a check manually. Signals are explainable rules, not a trained fraud classifier:

- At least 20 reservations in 15 minutes and at least four times the preceding seven-hour average.
- At least ten paid orders, three refunded orders and 20% refund incidence over seven days.
- A current inventory sale epoch that disagrees with the append-only sale ledger.
- Paid orders awaiting finalization for five minutes, or refund-pending orders created more than one hour ago.

Concurrent scans deduplicate with a store lock and stable fingerprints. Alerts retain evidence and last observation time. Managers acknowledge, dismiss or resolve with a note; every decision has actor/history records. Still-present resolved signals reopen on a later check. New/reopened signals enter the durable email outbox for verified owners. Signals do not automatically block customers or alter stock. Physical shelf-count discrepancies need physical counts; ledger consistency cannot detect sensor-free theft.

## Multilingual grounded assistant

English, Hindi and Kannada answers use authorized catalog, replenishment and order records and display their evidence fields and links. Read-only intent routing and translated response templates preserve numerical facts without requiring a generative provider. The UI reports `grounded-local`; this is a bounded operational assistant, not an unrestricted multilingual LLM. Catalog names remain as stored. Unsupported questions fall back to catalog search or an explicit empty result. The earlier optional Ollama overview remains separately available at `/store/intelligence/overview`; it does not authorize actions.

## Primary implementation references

- [Transformers.js pipeline documentation](https://huggingface.co/docs/transformers.js/en/pipelines), [local sentence model](https://huggingface.co/Xenova/all-MiniLM-L6-v2).
- [Tesseract.js maintained API and Node usage](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).
- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).
- [Forecasting: Principles and Practice, time-series cross-validation](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation).
