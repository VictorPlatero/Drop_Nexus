import { pool } from "../db/database.js";
import { decrypt, encrypt } from "../middleware/encryption.js";
import type { DbConfiguration, DbEngine } from "../types/index.js";

export interface ConfigInput {
  name: string;
  engine: DbEngine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  options?: Record<string, unknown>;
}

function decryptOptions(value: unknown): Record<string, unknown> {
  const options = { ...((value ?? {}) as Record<string, unknown>) };
  if (typeof options.connectionStringEncrypted === "string") {
    options.connectionString = decrypt(options.connectionStringEncrypted);
    delete options.connectionStringEncrypted;
  }
  return options;
}

function encryptOptions(value?: Record<string, unknown>): Record<string, unknown> {
  const options = { ...(value ?? {}) };
  if (typeof options.connectionString === "string" && options.connectionString) {
    options.connectionStringEncrypted = encrypt(options.connectionString);
    delete options.connectionString;
  }
  return options;
}

function mapConfig(row: Record<string, unknown>, includePassword = true): DbConfiguration {
  const expiresAt = row.expires_at ? new Date(row.expires_at as string).toISOString() : null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    engine: row.engine as DbEngine,
    host: row.host as string | undefined,
    port: row.port as number | undefined,
    database: row.database_name as string | undefined,
    username: row.username as string | undefined,
    password: includePassword ? decrypt(row.encrypted_password as string | null) : undefined,
    options: includePassword ? decryptOptions(row.options) : { ...((row.options ?? {}) as Record<string, unknown>), connectionStringEncrypted: undefined },
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    expiresAt
  };
}

export function publicConfig(config: DbConfiguration) {
  const { password: _password, ...safe } = config;
  const options = { ...(safe.options ?? {}) };
  delete options.connectionString;
  delete options.connectionStringEncrypted;
  return {
    ...safe,
    options,
    database: undefined,
    hasPassword: Boolean(config.password),
    hasDatabase: Boolean(config.database)
  };
}

export async function listConfigurations(userId: string, includePasswords = false): Promise<DbConfiguration[]> {
  const rows = (await pool.query(
    "SELECT * FROM db_configurations WHERE user_id=$1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC",
    [userId]
  )).rows;
  return rows.map((row) => mapConfig(row, includePasswords));
}

export async function getConfiguration(id: string, userId?: string): Promise<DbConfiguration | null> {
  const values = userId ? [id, userId] : [id];
  const result = await pool.query(
    `SELECT * FROM db_configurations WHERE id=$1${userId ? " AND user_id=$2" : ""} AND (expires_at IS NULL OR expires_at > now())`,
    values
  );
  return result.rows[0] ? mapConfig(result.rows[0], true) : null;
}

export async function createConfiguration(userId: string, input: ConfigInput): Promise<DbConfiguration> {
  const count = await pool.query(
    "SELECT COUNT(*)::int count FROM db_configurations WHERE user_id=$1 AND (expires_at IS NULL OR expires_at > now())",
    [userId]
  );
  if (count.rows[0].count >= 10) throw new Error("Límite de 10 configuraciones alcanzado");
  const expiresAtSql = input.options?.storageMode === "fileCatalog" ? "now()+interval '24 hours'" : "NULL";
  const result = await pool.query(
    `INSERT INTO db_configurations (user_id,name,engine,host,port,database_name,username,encrypted_password,options,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,${expiresAtSql}) RETURNING *`,
    [userId, input.name.trim(), input.engine, input.host || null, input.port || null, input.database || null, input.username || null, input.password ? encrypt(input.password) : null, encryptOptions(input.options)]
  );
  return mapConfig(result.rows[0]);
}

export async function updateConfiguration(id: string, userId: string, input: Partial<ConfigInput>): Promise<DbConfiguration | null> {
  const fields: string[] = []; const values: unknown[] = [];
  const add = (column: string, value: unknown) => { values.push(value); fields.push(`${column}=$${values.length}`); };
  if (input.name !== undefined) add("name", input.name.trim());
  if (input.engine !== undefined) add("engine", input.engine);
  if (input.host !== undefined) add("host", input.host || null);
  if (input.port !== undefined) add("port", input.port || null);
  if (input.database !== undefined) add("database_name", input.database || null);
  if (input.username !== undefined) add("username", input.username || null);
  if (input.password !== undefined && input.password !== "") add("encrypted_password", encrypt(input.password));
  if (input.options !== undefined) {
    const current = await pool.query("SELECT options FROM db_configurations WHERE id=$1 AND user_id=$2", [id, userId]);
    const existingOptions = (current.rows[0]?.options ?? {}) as Record<string, unknown>;
    add("options", {
      ...existingOptions,
      ...encryptOptions(input.options)
    });
    if (input.options.storageMode === "fileCatalog") {
      add("expires_at", new Date(Date.now() + 24 * 60 * 60 * 1000));
    } else if (input.options.connectionMode === "remote") {
      add("expires_at", null);
    }
  }
  if (!fields.length) return getConfiguration(id, userId);
  values.push(id, userId);
  const result = await pool.query(`UPDATE db_configurations SET ${fields.join(",")},updated_at=now() WHERE id=$${values.length - 1} AND user_id=$${values.length} RETURNING *`, values);
  return result.rows[0] ? mapConfig(result.rows[0]) : null;
}

export async function deleteConfiguration(id: string, userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM replications WHERE user_id=$1 AND (source_config_id=$2 OR destination_config_id=$2)",
      [userId, id]
    );
    await client.query("DELETE FROM health_checks WHERE config_id=$1::text", [id]);
    const result = await client.query("DELETE FROM db_configurations WHERE id=$1 AND user_id=$2", [id, userId]);
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
