import { createDatabase, migrate } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedDevelopment } from "../server/seed.js";
import { startWorkers } from "../server/protocol.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.includes("test")) {
  throw new Error(
    "Browser tests require a dedicated TEST_DATABASE_URL with 'test' in its database name.",
  );
}
const db = createDatabase(url);
await migrate(db);
await db.query(
  "TRUNCATE app_user,store,session,product,customer_order,inventory_unit,order_unit,unit_sale,idempotency_record,payment_event,outbox CASCADE",
);
await seedDevelopment(db);
const app = createApp(db, {
  origin: "http://127.0.0.1:4173",
  production: false,
  developmentPayments: true,
});
const server = app.listen(4173, "127.0.0.1");
const stop = startWorkers(db);
process.on("SIGTERM", () => {
  stop();
  server.close(() => void db.pool.end());
});
