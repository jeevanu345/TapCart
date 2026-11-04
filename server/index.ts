import { createDatabase } from "./db.js";
import { createApp } from "./app.js";
import { startWorkers } from "./protocol.js";
import { reconcileStripePayments } from "./stripe.js";
import { reconcileStripeRefunds } from "./refunds.js";
import { logger } from "./logger.js";

const production = process.env.NODE_ENV === "production";
const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const parsedOrigin = new URL(origin);
if (parsedOrigin.origin !== origin || !["http:", "https:"].includes(parsedOrigin.protocol))
  throw new Error("APP_ORIGIN must be an HTTP(S) origin without path or trailing slash.");
if (production && (!process.env.APP_ORIGIN || !origin.startsWith("https://")))
  throw new Error("Production requires an explicit HTTPS APP_ORIGIN.");
if (production && process.env.ALLOW_DEVELOPMENT_PAYMENTS === "true")
  throw new Error("Development payments cannot be enabled in production.");
const db = createDatabase(process.env.DATABASE_URL || "");
await db.query("SELECT 1 FROM schema_migration LIMIT 1");
const app = createApp(db, {
  origin,
  production,
  developmentPayments: process.env.ALLOW_DEVELOPMENT_PAYMENTS === "true",
  cardPayments: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
});
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, "0.0.0.0", () => logger.info({ port }, "TapCart listening"));
const stopWorkers = startWorkers(db);
let providerRunning = false;
const providerTimer = setInterval(async () => {
  if (providerRunning) return;
  providerRunning = true;
  try {
    await reconcileStripePayments(db);
    await reconcileStripeRefunds(db);
  } catch {
    logger.warn("Provider reconciliation needs retry");
  } finally {
    providerRunning = false;
  }
}, 60_000);
providerTimer.unref();
async function shutdown() {
  stopWorkers();
  clearInterval(providerTimer);
  server.close(async () => {
    await db.pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
