# Expanded PostgreSQL fault scenarios

`protocol.test.ts` executes eleven named implementation scenarios against real PostgreSQL, not mocks or the in-memory benchmark. Each run creates and migrates a randomly named schema using a pool with its own `search_path`; fixtures never truncate shared application/test tables. Teardown drops only that generated schema. `TEST_DATABASE_URL` must explicitly name a test database.

```sh
node --env-file=.env node_modules/vitest/vitest.mjs run research/faults/protocol.test.ts
```

The checked-in `results.txt` is raw output from the actual run on 7 November 2026: **11 tests passed**. Scenarios cover committed lost-response replay, simultaneous identical idempotency keys, changed payload under one key, rollback after checkout protection, interruption after callback/finalization before commit, duplicate settlement events, the formal rebinding counterexample, concurrent expiry retries, the formal foreign-release counterexample, return/resale epochs with an old payment replay, and authenticated tag counter compare-and-swap with rollback and eight concurrent submissions.

Assertions inspect authoritative database state and event/sale counts as well as service results. F4/F5/F11 inject exceptions inside real transactions, proving rollback; they do not terminate the PostgreSQL process or emulate storage loss. These are newly implemented scenarios and results, not a reconstruction of the paper's original eleven scenario harness or aggregate benchmark counts. No payment provider or NFC hardware is involved.
