import bcrypt from "bcryptjs";
import { pool } from "../db/database.js";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  isActive: boolean;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
}

function mapUser(row: Record<string, unknown>): PublicUser {
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    role: row.role as "user" | "admin",
    isActive: row.is_active as boolean,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string).toISOString() : null,
    loginCount: Number(row.login_count),
    createdAt: new Date(row.created_at as string).toISOString()
  };
}

export async function registerUser(name: string, email: string, password: string): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'user')
     RETURNING id, name, email, role, is_active, last_login_at, login_count, created_at`,
    [name.trim(), email.trim().toLowerCase(), passwordHash]
  );
  return mapUser(result.rows[0]);
}

export async function loginUser(email: string, password: string): Promise<PublicUser | null> {
  const result = await pool.query("SELECT * FROM users WHERE email=$1", [email.trim().toLowerCase()]);
  const row = result.rows[0];
  if (!row || !row.is_active || !await bcrypt.compare(password, row.password_hash)) return null;
  const updated = await pool.query(
    `UPDATE users SET last_login_at=now(), login_count=login_count+1, updated_at=now()
     WHERE id=$1 RETURNING id, name, email, role, is_active, last_login_at, login_count, created_at`,
    [row.id]
  );
  return mapUser(updated.rows[0]);
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const result = await pool.query("SELECT id, name, email, role, is_active, last_login_at, login_count, created_at FROM users WHERE id=$1", [id]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}
