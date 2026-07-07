import pg from "pg";
import type { Pool as PgPool, PoolClient, QueryConfig, QueryResult, QueryResultRow } from "pg";
import { logger } from "../utils/logger.js";

const { Pool } = pg;
let metadataPool: PgPool | undefined;

interface PublicError extends Error {
  statusCode?: number;
  exposeMessage?: boolean;
}

export function publicDatabaseErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("database_url")) {
    return "DATABASE_URL no esta configurado en Render.";
  }
  if (
    lower.includes("ecircuitbreaker") ||
    lower.includes("authentication failed") ||
    lower.includes("password authentication failed") ||
    lower.includes("too many authentication failures")
  ) {
    return "La base de datos rechazo la conexion. Corrige DATABASE_URL en Render y espera unos minutos si el proveedor bloqueo conexiones por autenticacion fallida.";
  }
  if (lower.includes("self-signed certificate") || lower.includes("certificate chain")) {
    return "No se pudo validar el certificado SSL de la base de datos. La aplicacion forzara SSL compatible con Supabase.";
  }
  return "La base de datos no esta disponible. Revisa DATABASE_URL en Render.";
}

function isDatabaseConnectionError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return Boolean(
    code && ["28P01", "3D000", "53300", "57P03", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"].includes(code)
  ) || [
    "database_url",
    "ecircuitbreaker",
    "authentication failed",
    "password authentication failed",
    "too many authentication failures",
    "self-signed certificate",
    "certificate chain",
    "connection terminated",
    "connect timeout",
    "timeout exceeded"
  ].some((part) => message.includes(part));
}

function normalizeDatabaseError(error: unknown): never {
  if (!isDatabaseConnectionError(error)) throw error;
  const publicError = new Error(publicDatabaseErrorMessage(error)) as PublicError;
  publicError.statusCode = 503;
  publicError.exposeMessage = true;
  throw publicError;
}

function createPool(): PgPool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!metadataPool) {
    metadataPool = new Pool({
      connectionString: databaseConnectionString(),
      ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000
    });
    metadataPool.on("error", (error) => logger.error({ error }, "Metadata database pool error"));
  }
  return metadataPool;
}

function databaseConnectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  try {
    const url = new URL(value);
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function shouldUseSsl(): boolean {
  const value = process.env.DATABASE_URL ?? "";
  return process.env.NODE_ENV === "production" || value.includes("supabase.com") || value.includes("sslmode=");
}

export const pool = {
  query<T extends QueryResultRow = any>(queryTextOrConfig: string | QueryConfig, values?: unknown[]): Promise<QueryResult<T>> {
    try {
      const db = createPool();
      const query = values ? db.query<T>(queryTextOrConfig as string, values) : db.query<T>(queryTextOrConfig);
      return query.catch((error) => normalizeDatabaseError(error));
    } catch (error) {
      normalizeDatabaseError(error);
    }
  },
  connect(): Promise<PoolClient> {
    try {
      return createPool().connect().catch((error) => normalizeDatabaseError(error));
    } catch (error) {
      normalizeDatabaseError(error);
    }
  },
  end(): Promise<void> {
    return metadataPool ? metadataPool.end() : Promise.resolve();
  }
};

export async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'user',
      is_active boolean NOT NULL DEFAULT true,
      last_login_at timestamptz,
      login_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS db_configurations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      engine text NOT NULL,
      host text,
      port integer,
      database_name text,
      username text,
      encrypted_password text,
      options jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS replications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_config_id uuid NOT NULL REFERENCES db_configurations(id) ON DELETE CASCADE,
      destination_config_id uuid NOT NULL REFERENCES db_configurations(id) ON DELETE CASCADE,
      source_table text NOT NULL,
      destination_table text NOT NULL,
      status text NOT NULL DEFAULT 'stopped',
      records_copied bigint NOT NULL DEFAULT 0,
      lag_seconds integer NOT NULL DEFAULT 0,
      last_error text,
      started_at timestamptz,
      stopped_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS health_checks (
      id bigserial PRIMARY KEY,
      user_id text NOT NULL,
      config_id text NOT NULL,
      status text NOT NULL,
      latency_ms integer NOT NULL,
      read_rows_per_second numeric,
      error text,
      checked_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS database_catalogs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      original_name text NOT NULL,
      source_engine text NOT NULL,
      catalog_data bytea NOT NULL,
      size_bytes bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_db_configurations_user_id ON db_configurations(user_id);
    CREATE INDEX IF NOT EXISTS idx_replications_user_status ON replications(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_users_activity ON users(last_login_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_health_checks_config_time ON health_checks(config_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_database_catalogs_user_id ON database_catalogs(user_id);
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role text DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count integer DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS user_id uuid;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS name text;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS engine text;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS host text;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS port integer;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS database_name text;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS username text;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS encrypted_password text;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS options jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
    ALTER TABLE db_configurations ALTER COLUMN expires_at DROP NOT NULL;
    ALTER TABLE db_configurations ALTER COLUMN expires_at DROP DEFAULT;
    UPDATE db_configurations SET expires_at = NULL WHERE COALESCE(options->>'storageMode', '') <> 'fileCatalog';
    UPDATE db_configurations SET expires_at = created_at + interval '24 hours' WHERE options->>'storageMode' = 'fileCatalog' AND expires_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_db_configurations_expires_at ON db_configurations(expires_at);
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS user_id uuid;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS source_config_id uuid;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS destination_config_id uuid;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS source_table text;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS destination_table text;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS status text DEFAULT 'stopped';
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS records_copied bigint DEFAULT 0;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS lag_seconds integer DEFAULT 0;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS last_error text;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS started_at timestamptz;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS stopped_at timestamptz;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS group_id uuid DEFAULT gen_random_uuid();
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS options jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS total_records bigint;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS failed_records bigint DEFAULT 0;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS current_offset bigint DEFAULT 0;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS current_batch integer DEFAULT 0;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS speed_rows_per_second numeric DEFAULT 0;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS completed_at timestamptz;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS next_run_at timestamptz;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS error_details jsonb DEFAULT '[]'::jsonb;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS failure_stage text;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS failure_code text;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS failure_cause text;
    ALTER TABLE replications ADD COLUMN IF NOT EXISTS recommendation text;
    DO $$
    DECLARE constraint_name text;
    BEGIN
      IF to_regclass('health_checks') IS NOT NULL THEN
        FOR constraint_name IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'health_checks'::regclass
            AND contype = 'f'
        LOOP
          EXECUTE format('ALTER TABLE health_checks DROP CONSTRAINT %I', constraint_name);
        END LOOP;
        ALTER TABLE health_checks ALTER COLUMN user_id TYPE text USING user_id::text;
        ALTER TABLE health_checks ALTER COLUMN config_id TYPE text USING config_id::text;
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(lower(email));
    CREATE INDEX IF NOT EXISTS idx_replications_group_id ON replications(group_id);
    CREATE INDEX IF NOT EXISTS idx_replications_next_run ON replications(next_run_at) WHERE next_run_at IS NOT NULL;
  `);
  logger.info("Metadata database initialized");
}
