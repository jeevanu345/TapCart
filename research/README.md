# Reproducible measurement tools

These Node.js / TypeScript tools are new to this rebuild. They are not the missing original TLA+ model, raw paper results or benchmark artifacts, and they do not claim to reproduce the paper's numerical results.

## NFC / QR field collection

Run `npx tsx research/field-server.ts` and open the printed loopback URL. The local observer form appends validated trials to `field-measurements.csv` (override `FIELD_OUTPUT` and `FIELD_PORT`). The file is created with owner-only permissions; collect device/model/condition labels rather than participant names, phone numbers or other personal data. The server is intentionally loopback-only. Do not expose this observer collector as a production service.

The form records measurements supplied by a researcher; it does not infer NFC read success or physical tap latency. Obtain latency from synchronized test instrumentation: start on the defined physical presentation cue, mark successful tag/QR URI resolution, and finish on the authoritative reservation response. Document the clock, cue, read timeout, retry policy, URI launch behavior, network and whether browser startup is included. A human stopwatch measures observer timing, not instrumented tap-to-reservation latency; label such data separately. Preserve application trace IDs separately if needed without leaking customer sessions.

Use at least four phone models, several tag types (for example NTAG213/215/216), and representative paper/plastic/metal/liquid-adjacent conditions. Use an on-metal tag or spacer as a separate documented condition. Test serialized QR on the same phones/products under the same network and lighting conditions. Predefine at least 100 attempts for each phone × tag × material × carrier condition; record **all failures**, not only successful reads. Reset/release the test reservation safely between attempts so occupied units are not mistaken for NFC failures. Separate read failures, URI launch failures and legitimate reservation conflicts in the raw trial log/condition taxonomy.

CSV format:

```csv
condition,phone,tag,material,carrier,success,latency_ms
pilot,phone-model-A,NTAG213,paper,NFC,true,420
pilot,phone-model-A,NTAG213,paper,NFC,false,
```

Analyze with `npx tsx research/field-analysis.ts field-measurements.csv > field-summary.json`. Every grouping includes its trial/success count, success proportion and 95% Wilson confidence interval, plus mean and nearest-rank p95 successful latency. Latency excludes failures and must be interpreted beside failure rate; the output flags groups below 100 attempts. These are descriptive summaries, not a paired statistical test or a causal claim. Quote handling, multiline fields, malformed rows, interval boundaries and successful-only latency have automated tests.

For the paper's proposed usability study, obtain appropriate institutional consent/review; use pseudonymous participant IDs in a separate study record. Compare NFC, serialized QR and conventional checkout within subjects. Counterbalance the six task orders (NQC, NCQ, QNC, QCN, CNQ, CQN) across participants, keep basket/task difficulty equal, and record task completion time as the primary measure, with SUS and NASA-TLX as secondary measures. Predefine error/failure handling, exclusion rules and analysis before collection. The present CSV tool covers phone/tag/material read trials, not participant-level questionnaires or inferential analysis.

Provisioning evaluation must use a real encoder: record batch manifest UUIDs/URIs, encode duration, read-back mismatch/retry rate, attachment checks and lock state. Server-side record creation is not proof that a tag has been encoded or read back.

## NDEF capacity

Run `npx tsx research/ndef.ts 'https://store.example.com/u/019535d9-3df7-79fb-b466-fa907fa17f9e' 144`. The tool counts UTF-8 URI bytes, NFC URI prefix compression, short/normal record headers and Type 2 TLV overhead, returning fit/free-space estimates. It reproduces the manuscript's 64-byte example and handles extended lengths. Capacity means user bytes available for this one NDEF TLV; existing records, reserved memory and other application data reduce that budget. This utility does not write/lock tags, verify hardware, or authenticate NTAG424 messages.

## PostgreSQL hot-unit contention

Use a disposable test database with permission to create/drop an isolated table:

```sh
TEST_DATABASE_URL=postgres://localhost/tapcart_test BENCH_CLIENTS=10 BENCH_ROUNDS=10 npx tsx research/benchmark.ts > contention.json
```

Only `TEST_DATABASE_URL` is accepted; the application `DATABASE_URL` is deliberately ignored. The harness creates a unique `tapcart_bench_<random>` unlogged table, uses pre-acquired independent PostgreSQL clients, resets its one row per round and drops only its own table in `finally`. A force-killed process can leave that uniquely named table behind; inspect before manual cleanup. Real application inventory is never queried or modified. Do not set the test URL to a production database.

Conditional UPDATE and SELECT FOR UPDATE compete for the same available row under default PostgreSQL Read Committed semantics. Both must report exactly one successful owner per round. The intentionally unsafe negative control synchronizes every stale SELECT before unconditional UPDATE, deterministically exposing multiple reported owners for concurrency above one. That extra barrier makes its latency unsuitable for performance comparison. Output records node/PostgreSQL versions, per-round reported successes, final row/version, oversold flags and p50/p95 latency. Repeated modes use a fixed order; use independent repeated runs and randomize order for a formal performance study. This is a correctness probe, not the paper's low-contention/RTT benchmark or full payment fault-injection suite.

Run at 1, 10, 50, 100 and 200 clients only if the database connection/resource limits support them; preserve actual CPU/RAM, database configuration, OS/network, run count and raw output. A local result cannot establish performance of another deployment. The harness exits unsuccessfully if correct modes violate exclusivity or its multi-client negative control fails to expose the defect.
