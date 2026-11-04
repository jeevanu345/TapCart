import { createDatabase, migrate } from "../db.js";
const db = createDatabase(process.env.DATABASE_URL || "");
try {
  await migrate(db);
  console.log("Database migrations applied.");
} finally {
  await db.pool.end();
}
