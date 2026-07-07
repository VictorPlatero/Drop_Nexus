import mysql, { type Pool } from "mysql2/promise";
import type { DatabaseAdapter } from "./DatabaseAdapter.js";
import { qualifiedIdentifier, splitQualifiedName } from "./DatabaseAdapter.js";
import type { ColumnSchema, ConnectionTest, DbConfiguration, TableSchema } from "../types/index.js";
import { buildCreateTableSql } from "../utils/typeMapper.js";

export class MySQLAdapter implements DatabaseAdapter {
  private pool?: Pool;
  constructor(public readonly config: DbConfiguration) {}
  async connect(): Promise<void> {
    if (this.pool) return;
    const connectionString = typeof this.config.options?.connectionString === "string" && this.config.options.connectionString
      ? this.config.options.connectionString
      : undefined;
    const common = {
      connectTimeout: Number(this.config.options?.connectionTimeoutMs ?? 15000),
      connectionLimit: 3,
      ssl: this.config.options?.ssl ? { rejectUnauthorized: false } : undefined
    };
    this.pool = connectionString
      ? mysql.createPool({ uri: connectionString, ...common })
      : mysql.createPool({
        host: this.config.host,
        port: this.config.port ?? 3306,
        database: this.config.database,
        user: this.config.username,
        password: this.config.password,
        ...common
      });
    await this.pool.query("SELECT 1");
  }
  async close(): Promise<void> { await this.pool?.end(); this.pool = undefined; }
  private db(): Pool { if (!this.pool) throw new Error("Adapter not connected"); return this.pool; }
  async testConnection(): Promise<ConnectionTest> {
    const start = performance.now();
    try { await this.connect(); await this.db().query("SELECT 1"); return { ok: true, latencyMs: Math.round(performance.now() - start) }; }
    catch (error) { return { ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "Connection failed" }; }
  }
  async listTables(): Promise<string[]> {
    const [rows] = await this.db().query<mysql.RowDataPacket[]>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name");
    return rows.map((r) => r.name as string);
  }
  async getTableSchema(name: string): Promise<TableSchema> {
    const { table } = splitQualifiedName(name);
    const [rows] = await this.db().query<mysql.RowDataPacket[]>(`SELECT c.column_name, c.data_type, c.is_nullable, c.column_key, c.column_default, EXISTS(SELECT 1 FROM information_schema.key_column_usage k WHERE k.table_schema=c.table_schema AND k.table_name=c.table_name AND k.column_name=c.column_name AND k.referenced_table_name IS NOT NULL) fk FROM information_schema.columns c WHERE c.table_schema=DATABASE() AND c.table_name=? ORDER BY c.ordinal_position`, [table]);
    return { name, columns: rows.map((r) => ({ name: r.column_name, dataType: r.data_type, nullable: r.is_nullable === "YES", primaryKey: r.column_key === "PRI", foreignKey: Boolean(r.fk), defaultValue: r.column_default })) };
  }
  async tableExists(name: string): Promise<boolean> {
    const { table } = splitQualifiedName(name);
    const [rows] = await this.db().query<mysql.RowDataPacket[]>("SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", [table]);
    return Number(rows[0]?.count) > 0;
  }
  previewCreateTable(table: string, columns: ColumnSchema[]): string { return buildCreateTableSql(table, columns, this.config.engine === "mariadb" ? "mariadb" : "mysql"); }
  async createTable(table: string, columns: ColumnSchema[]): Promise<void> { await this.db().query(this.previewCreateTable(table, columns)); }
  async countRows(table: string): Promise<number> {
    const [rows] = await this.db().query<mysql.RowDataPacket[]>(`SELECT COUNT(*) count FROM ${qualifiedIdentifier(table, this.config.engine)}`);
    return Number(rows[0]?.count ?? 0);
  }
  async clearTable(table: string): Promise<void> { await this.db().query(`TRUNCATE TABLE ${qualifiedIdentifier(table, this.config.engine)}`); }
  async readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    const [rows] = await this.db().query<mysql.RowDataPacket[]>(`SELECT * FROM ${qualifiedIdentifier(table, this.config.engine)} LIMIT ? OFFSET ?`, [limit, offset]); return rows;
  }
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<number> {
    if (!rows.length) return 0;
    const columns = Object.keys(rows[0]!);
    const values = rows.map((row) => columns.map((column) => row[column]));
    await this.db().query(`INSERT INTO ${qualifiedIdentifier(table, this.config.engine)} (${columns.map((c) => qualifiedIdentifier(c, this.config.engine)).join(",")}) VALUES ?`, [values]);
    return rows.length;
  }
  async upsertBatch(table: string, rows: Record<string, unknown>[], keyColumns: string[]): Promise<number> {
    if (!rows.length) return 0;
    if (!keyColumns.length) throw new Error("UPsert requiere una clave primaria");
    const columns = Object.keys(rows[0]!);
    const values = rows.map((row) => columns.map((column) => row[column]));
    const updates = columns.filter((column) => !keyColumns.includes(column))
      .map((column) => `${qualifiedIdentifier(column, this.config.engine)}=VALUES(${qualifiedIdentifier(column, this.config.engine)})`);
    await this.db().query(
      `${updates.length ? "INSERT" : "INSERT IGNORE"} INTO ${qualifiedIdentifier(table, this.config.engine)} (${columns.map((column) => qualifiedIdentifier(column, this.config.engine)).join(",")}) VALUES ? ${updates.length ? `ON DUPLICATE KEY UPDATE ${updates.join(",")}` : ""}`,
      [values]
    );
    return rows.length;
  }
  async verifyReadPermission(table: string): Promise<void> { await this.db().query(`SELECT 1 FROM ${qualifiedIdentifier(table, this.config.engine)} LIMIT 0`); }
  async verifyWritePermission(table: string, exists: boolean): Promise<void> {
    if (exists) await this.db().query(`INSERT INTO ${qualifiedIdentifier(table, this.config.engine)} SELECT * FROM ${qualifiedIdentifier(table, this.config.engine)} WHERE 1=0`);
    else await this.db().query("SELECT 1");
  }
}
