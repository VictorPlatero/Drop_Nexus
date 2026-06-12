import bcrypt from "bcryptjs";
import { pool } from "../db/database.js";
import { logger } from "../utils/logger.js";

export async function seedAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? "victorplateromaron58@gmail.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "gatito1234";
  const name = process.env.ADMIN_NAME ?? "Victor Platero";
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'admin', true)
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       role = 'admin',
       is_active = true,
       updated_at = now()`,
    [name, email, passwordHash]
  );
  logger.info({ email }, "Admin seed ensured");
}
