import pg from "pg";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

pool.on("error", (error) => logger.error({ error }, "Metadata database pool error"));

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
      expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
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
    CREATE INDEX IF NOT EXISTS idx_db_configurations_user_id ON db_configurations(user_id);
    CREATE INDEX IF NOT EXISTS idx_replications_user_status ON replications(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_users_activity ON users(last_login_at, created_at);
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
    ALTER TABLE db_configurations ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '24 hours');
    UPDATE db_configurations SET expires_at = created_at + interval '24 hours' WHERE expires_at IS NULL;
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(lower(email));
  `);
  await pool.query(`
    DO $$
    DECLARE constraint_name text;
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'replications'
          AND column_name = 'destination_config_id'
          AND data_type = 'uuid'
      ) AND NOT EXISTS (SELECT 1 FROM replications) THEN
        FOR constraint_name IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'replications'::regclass
            AND pg_get_constraintdef(oid) ILIKE '%destination_config_id%'
        LOOP
          EXECUTE format('ALTER TABLE replications DROP CONSTRAINT %I', constraint_name);
        END LOOP;
        ALTER TABLE replications
          ALTER COLUMN destination_config_id TYPE integer USING NULL::integer;
      END IF;
    END $$;
  `);
  logger.info("Metadata database initialized");
}
