import { logger } from "./logger.js";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface Database {
  pool: pg.Pool;
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>>;
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}
export function createDatabase(connectionString: string): Database {
  if (!connectionString)
    throw new Error(
      "DATABASE_URL is required. Run npm run db:local for a local development database.",
    );
  const pool = new pg.Pool({
    connectionString,
    max: 24,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "tapcart",
  });
  pool.on("error", (error) =>
    logger.error({ errorName: error.name }, "Idle database connection error"),
  );
  return {
    pool,
    query: (sql, values) => pool.query(sql, values),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
export async function migrate(db: Database): Promise<void> {
  const directory = fileURLToPath(new URL("./migrations/", import.meta.url));
  await db.transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('tapcart-schema-migrations'))");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      if (!(await client.query("SELECT 1 FROM schema_migration WHERE name=$1", [name])).rowCount) {
        await client.query(await readFile(`${directory}/${name}`, "utf8"));
        await client.query("INSERT INTO schema_migration(name) VALUES($1)", [name]);
      }
    }
  });
}
type CamelCase<S extends string> = S extends `${infer A}_${infer B}`
  ? `${A}${Capitalize<CamelCase<B>>}`
  : S;
type Jsonified<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T as K extends string ? CamelCase<K> : K]: Jsonified<T[K]> }
      : T;
export function json<T>(value: T): Jsonified<T>;
export function json(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
        typeof item === "string" && ["version", "protected_version"].includes(key)
          ? Number(item)
          : json(item),
      ]),
    );
  return value;
}
