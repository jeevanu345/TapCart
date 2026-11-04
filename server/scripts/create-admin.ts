import { z } from "zod";
import { v7 as uuid } from "uuid";
import { createDatabase } from "../db.js";
import { hashPassword } from "../auth.js";
const email = z.string().email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = z.string().min(14).max(128).parse(process.env.ADMIN_PASSWORD);
const name = z
  .string()
  .min(1)
  .max(200)
  .parse(process.env.ADMIN_NAME || "Administrator");
const db = createDatabase(process.env.DATABASE_URL || "");
try {
  await db.query(
    "INSERT INTO app_user(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'ADMIN')",
    [uuid(), name, email, await hashPassword(password)],
  );
  console.log("Administrator account created.");
} finally {
  await db.pool.end();
}
