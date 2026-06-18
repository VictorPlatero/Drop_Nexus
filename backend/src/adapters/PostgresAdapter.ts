import pg from "pg";
import type { DatabaseAdapter } from "./DatabaseAdapter.js";
import { qualifiedIdentifier, splitQualifiedName } from "./DatabaseAdapter.js";
import type { ColumnSchema, ConnectionTest, DbConfiguration, TableSchema } from "../types/index.js";
import { buildCreateTableSql } from "../utils/typeMapper.js";

export class PostgresAdapter implements DatabaseAdapter {
  private pool?: pg.Pool;
  constructor(public readonly config: DbConfiguration) {}

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = new pg.Pool({
      host: this.config.host,
      port: this.config.port ?? 5432,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      connectionTimeoutMillis: 5000,
      max: 3,
      ssl: this.config.options?.ssl ? { rejectUnauthorized: false } : undefined
    });
    await this.pool.query("SELECT 1");
  }
  async close(): Promise<void> { await this.pool?.end(); this.pool = undefined; }
  private db(): pg.Pool { if (!this.pool) throw new Error("Adapter not connected"); return this.pool; }
  async testConnection(): Promise<ConnectionTest> {
    const start = performance.now();
    try { await this.connect(); await this.db().query("SELECT 1"); return { ok: true, latencyMs: Math.round(performance.now() - start) }; }
    catch (error) { return { ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "Connection failed" }; }
  }
  async listTables(): Promise<string[]> {
    const result = await this.db().query(`SELECT table_schema || '.' || table_name AS name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1`);
    return result.rows.map((row) => row.name as string);
  }
  async getTableSchema(name: string): Promise<TableSchema> {
    const { schema = "public", table } = splitQualifiedName(name);
    const result = await this.db().query(`
      SELECT c.column_name, c.data_type, c.is_nullable,
        EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema, table_name) WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema=c.table_schema AND tc.table_name=c.table_name AND kcu.column_name=c.column_name) AS pk,
        EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema, table_name) WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=c.table_schema AND tc.table_name=c.table_name AND kcu.column_name=c.column_name) AS fk,
        c.column_default
      FROM information_schema.columns c WHERE c.table_schema=$1 AND c.table_name=$2 ORDER BY c.ordinal_position`, [schema, table]);
    return { name, columns: result.rows.map((r) => ({ name: r.column_name, dataType: r.data_type, nullable: r.is_nullable === "YES", primaryKey: r.pk, foreignKey: r.fk, defaultValue: r.column_default })) };
  }
  async tableExists(name: string): Promise<boolean> {
    const { schema = "public", table } = splitQualifiedName(name);
    const result = await this.db().query("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2)", [schema, table]);
    return result.rows[0].exists;
  }
  previewCreateTable(table: string, columns: ColumnSchema[]): string { return buildCreateTableSql(table, columns, "postgresql"); }
  async createTable(table: string, columns: ColumnSchema[]): Promise<void> { await this.db().query(this.previewCreateTable(table, columns)); }
  async countRows(table: string): Promise<number> {
    return Number((await this.db().query(`SELECT COUNT(*) count FROM ${qualifiedIdentifier(table, "postgresql")}`)).rows[0].count);
  }
  async clearTable(table: string): Promise<void> { await this.db().query(`TRUNCATE TABLE ${qualifiedIdentifier(table, "postgresql")}`); }
  async readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    return (await this.db().query(`SELECT * FROM ${qualifiedIdentifier(table, "postgresql")} OFFSET $1 LIMIT $2`, [offset, limit])).rows;
  }
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<number> {
    if (!rows.length) return 0;
    const columns = Object.keys(rows[0]!);
    const values: unknown[] = [];
    const groups = rows.map((row, rowIndex) => `(${columns.map((column, columnIndex) => { values.push(row[column]); return `$${rowIndex * columns.length + columnIndex + 1}`; }).join(",")})`);
    await this.db().query(`INSERT INTO ${qualifiedIdentifier(table, "postgresql")} (${columns.map((c) => qualifiedIdentifier(c, "postgresql")).join(",")}) VALUES ${groups.join(",")}`, values);
    return rows.length;
  }
  async upsertBatch(table: string, rows: Record<string, unknown>[], keyColumns: string[]): Promise<number> {
    if (!rows.length) return 0;
    if (!keyColumns.length) throw new Error("UPsert requiere una clave primaria");
    const columns = Object.keys(rows[0]!);
    const values: unknown[] = [];
    const groups = rows.map((row, rowIndex) => `(${columns.map((column, columnIndex) => {
      values.push(row[column]); return `$${rowIndex * columns.length + columnIndex + 1}`;
    }).join(",")})`);
    const updates = columns.filter((column) => !keyColumns.includes(column))
      .map((column) => `${qualifiedIdentifier(column, "postgresql")}=EXCLUDED.${qualifiedIdentifier(column, "postgresql")}`);
    const conflict = keyColumns.map((column) => qualifiedIdentifier(column, "postgresql")).join(",");
    await this.db().query(
      `INSERT INTO ${qualifiedIdentifier(table, "postgresql")} (${columns.map((column) => qualifiedIdentifier(column, "postgresql")).join(",")}) VALUES ${groups.join(",")} ON CONFLICT (${conflict}) ${updates.length ? `DO UPDATE SET ${updates.join(",")}` : "DO NOTHING"}`,
      values
    );
    return rows.length;
  }
  async verifyReadPermission(table: string): Promise<void> { await this.db().query(`SELECT 1 FROM ${qualifiedIdentifier(table, "postgresql")} LIMIT 0`); }
  async verifyWritePermission(table: string, exists: boolean): Promise<void> {
    if (exists) await this.db().query(`INSERT INTO ${qualifiedIdentifier(table, "postgresql")} SELECT * FROM ${qualifiedIdentifier(table, "postgresql")} WHERE false`);
    else await this.db().query("SELECT has_database_privilege(current_database(), 'CREATE')");
  }
}
