import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg, { type PoolClient } from "pg";

function positiveInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be 1–${maximum}`);
  return value;
}

function barrier(participants: number) {
  let count = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    count++;
    if (count === participants) release();
    await ready;
  };
}

async function main() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "Set TEST_DATABASE_URL to a disposable PostgreSQL test database; DATABASE_URL is deliberately ignored.",
    );
  const concurrency = positiveInteger("BENCH_CLIENTS", 10, 200);
  const rounds = positiveInteger("BENCH_ROUNDS", 10, 1000);
  const table = `tapcart_bench_${randomUUID().replaceAll("-", "")}`;
  const pool = new pg.Pool({
    connectionString,
    max: concurrency + 1,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
  });
  const clients: PoolClient[] = [];
  let created = false;
  const results: Record<string, unknown>[] = [];
  try {
    await pool.query(
      `CREATE UNLOGGED TABLE ${table} (id integer PRIMARY KEY, status text NOT NULL, owner integer, version bigint NOT NULL DEFAULT 0)`,
    );
    created = true;
    await pool.query(`INSERT INTO ${table} (id, status) VALUES (1, 'AVAILABLE')`);
    // Sequential acquisition preserves handles for cleanup even if a later connection fails.
    for (let index = 0; index < concurrency; index++) clients.push(await pool.connect());
    for (const mode of ["conditional", "select_for_update", "naive"] as const) {
      for (let round = 1; round <= rounds; round++) {
        await pool.query(
          `UPDATE ${table} SET status='AVAILABLE', owner=NULL, version=0 WHERE id=1`,
        );
        const start = barrier(concurrency);
        const naiveReadsDone = barrier(concurrency);
        const startedAt = performance.now();
        const attempts = await Promise.allSettled(
          clients.map(async (client, index) => {
            await start();
            const before = performance.now();
            let success = false;
            if (mode === "conditional") {
              const result = await client.query(
                `UPDATE ${table} SET status='RESERVED', owner=$1, version=version+1 WHERE id=1 AND status='AVAILABLE' RETURNING version`,
                [index],
              );
              success = result.rowCount === 1;
            } else if (mode === "select_for_update") {
              await client.query("BEGIN");
              try {
                const result = await client.query<{ status: string }>(
                  `SELECT status FROM ${table} WHERE id=1 FOR UPDATE`,
                );
                if (result.rows[0]?.status === "AVAILABLE") {
                  await client.query(
                    `UPDATE ${table} SET status='RESERVED', owner=$1, version=version+1 WHERE id=1`,
                    [index],
                  );
                  success = true;
                }
                await client.query("COMMIT");
              } catch (error) {
                await client.query("ROLLBACK").catch(() => undefined);
                throw error;
              }
            } else {
              // Deliberately synchronize stale reads: this is a deterministic negative control,
              // not a fair throughput competitor and never touches application inventory.
              let available = false;
              try {
                const result = await client.query<{ status: string }>(
                  `SELECT status FROM ${table} WHERE id=1`,
                );
                available = result.rows[0]?.status === "AVAILABLE";
              } finally {
                await naiveReadsDone();
              }
              if (available) {
                await client.query(
                  `UPDATE ${table} SET status='RESERVED', owner=$1, version=version+1 WHERE id=1`,
                  [index],
                );
                success = true;
              }
            }
            return { success, latency_ms: performance.now() - before };
          }),
        );
        const failure = attempts.find((attempt) => attempt.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        const completed = attempts.flatMap((attempt) =>
          attempt.status === "fulfilled" ? [attempt.value] : [],
        );
        const latencies = completed.map((attempt) => attempt.latency_ms).sort((a, b) => a - b);
        const final = await pool.query<{ status: string; owner: number; version: string }>(
          `SELECT status, owner, version FROM ${table} WHERE id=1`,
        );
        const successes = completed.filter((attempt) => attempt.success).length;
        results.push({
          mode,
          round,
          clients: concurrency,
          reported_successes: successes,
          oversold: successes > 1,
          final: final.rows[0],
          round_ms: performance.now() - startedAt,
          p50_ms: latencies[Math.ceil(latencies.length * 0.5) - 1],
          p95_ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
        });
      }
    }
    const server = await pool.query<{ version: string }>("SELECT version()");
    console.log(
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          node: process.version,
          postgres: server.rows[0]?.version,
          workload: "one-unit hot contention; pre-acquired clients; no emulated RTT",
          negative_control:
            "naive reads synchronized before unconditional updates; latency not comparable",
          rounds,
          results,
        },
        null,
        2,
      ),
    );
    if (
      results.some(
        (result) => result.mode !== "naive" && (result.reported_successes !== 1 || result.oversold),
      )
    )
      throw new Error("Correct reservation implementation violated exclusivity");
    if (concurrency > 1 && results.some((result) => result.mode === "naive" && !result.oversold))
      throw new Error("Negative control failed to expose a race");
  } finally {
    clients.forEach((client) => client.release());
    try {
      if (created) await pool.query(`DROP TABLE ${table}`);
    } finally {
      await pool.end();
    }
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed");
  process.exitCode = 1;
});
