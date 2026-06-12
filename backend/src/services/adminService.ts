import { pool } from "../db/database.js";

export interface UserFilters {
  search?: string;
  role?: "admin" | "user";
  active?: boolean;
  last7Days?: boolean;
}

export async function getAdminStats() {
  const [totals, recent] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE created_at >= now()-interval '7 days')::int new_last_7_days,
      COUNT(*) FILTER (WHERE last_login_at >= now()-interval '24 hours')::int active_today FROM users`),
    pool.query(`SELECT id, name, email, role, is_active, last_login_at, created_at FROM users
      WHERE created_at >= now()-interval '7 days' OR last_login_at >= now()-interval '7 days'
      ORDER BY GREATEST(created_at, COALESCE(last_login_at, created_at)) DESC LIMIT 50`)
  ]);
  return { ...totals.rows[0], recentActivity: recent.rows };
}

export async function listUsers(filters: UserFilters) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    conditions.push(`(name ILIKE $${values.length} OR email ILIKE $${values.length})`);
  }
  if (filters.role) { values.push(filters.role); conditions.push(`role=$${values.length}`); }
  if (filters.active !== undefined) { values.push(filters.active); conditions.push(`is_active=$${values.length}`); }
  if (filters.last7Days) conditions.push(`(created_at >= now()-interval '7 days' OR last_login_at >= now()-interval '7 days')`);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return (await pool.query(`SELECT id, name, email, role, is_active, last_login_at, login_count, created_at FROM users ${where} ORDER BY created_at DESC`, values)).rows;
}

export async function updateUserByAdmin(id: string, data: { name?: string; email?: string; role?: "admin" | "user"; isActive?: boolean }) {
  const fields: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => { values.push(value); fields.push(`${column}=$${values.length}`); };
  if (data.name !== undefined) add("name", data.name.trim());
  if (data.email !== undefined) add("email", data.email.trim().toLowerCase());
  if (data.role !== undefined) add("role", data.role);
  if (data.isActive !== undefined) add("is_active", data.isActive);
  if (!fields.length) return null;
  values.push(id);
  return (await pool.query(`UPDATE users SET ${fields.join(",")}, updated_at=now() WHERE id=$${values.length} RETURNING id,name,email,role,is_active,last_login_at,login_count,created_at`, values)).rows[0] ?? null;
}

export async function deleteUserByAdmin(id: string): Promise<boolean> {
  return (await pool.query("DELETE FROM users WHERE id=$1", [id])).rowCount === 1;
}
