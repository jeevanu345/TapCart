import { createDatabase } from "../db.js";
import { developmentCredentials, seedDevelopment } from "../seed.js";
if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEVELOPMENT_SEED !== "true")
  throw new Error("Set ALLOW_DEVELOPMENT_SEED=true only for a development database.");
const db = createDatabase(process.env.DATABASE_URL || "");
try {
  await seedDevelopment(db);
  console.log("Development database ready.", developmentCredentials);
} finally {
  await db.pool.end();
}
