import { createRequire } from "node:module";
import type sqlite3 from "sqlite3";
import type { DatabaseAdapter } from "./DatabaseAdapter.js";
import { qualifiedIdentifier } from "./DatabaseAdapter.js";
import type { ColumnSchema, ConnectionTest, DbConfiguration, TableSchema } from "../types/index.js";
import { buildCreateTableSql } from "../utils/typeMapper.js";

const require = createRequire(import.meta.url);
let sqlite3Module: typeof sqlite3 | undefined;

function loadSqlite3(): typeof sqlite3 {
  try {
    sqlite3Module ??= require("sqlite3") as typeof sqlite3;
    return sqlite3Module;
  } catch {
    throw new Error("Soporte SQLite no instalado correctamente. Ejecuta npm install en backend para compilar sqlite3.");
  }
}

export class SQLiteAdapter implements DatabaseAdapter {
  private database?: sqlite3.Database;
  constructor(public readonly config: DbConfiguration) {}

  async connect(): Promise<void> {
    if (this.database) return;
    const filename = this.config.database;
    if (!filename) throw new Error("SQLite requiere la ruta del archivo en database");
    const sqlite3 = loadSqlite3();
    this.database = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(filename, (error) => error ? reject(error) : resolve(db));
    });
    await this.get("SELECT 1 value");
  }
  async close(): Promise<void> {
    if (!this.database) return;
    const db = this.database;
    await new Promise<void>((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
    this.database = undefined;
  }
  private db(): sqlite3.Database { if (!this.database) throw new Error("Adapter not connected"); return this.database; }
  private all<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => this.db().all(query, params, (error, rows) => error ? reject(error) : resolve(rows as T[])));
  }
  private get<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T> {
    return new Promise((resolve, reject) => this.db().get(query, params, (error, row) => error ? reject(error) : resolve(row as T)));
  }
  private run(query: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => this.db().run(query, params, (error) => error ? reject(error) : resolve()));
  }
  async testConnection(): Promise<ConnectionTest> {
    const start = performance.now();
    try { await this.connect(); await this.get("SELECT 1"); return { ok: true, latencyMs: Math.round(performance.now() - start) }; }
    catch (error) { return { ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "Connection failed" }; }
  }
  async listTables(): Promise<string[]> {
    const rows = await this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    return rows.map((row) => row.name);
  }
  async getTableSchema(name: string): Promise<TableSchema> {
    const columns = await this.all<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }>(`PRAGMA table_info(${qualifiedIdentifier(name, "sqlite")})`);
    const foreignKeys = await this.all<{ from: string }>(`PRAGMA foreign_key_list(${qualifiedIdentifier(name, "sqlite")})`);
    const fk = new Set(foreignKeys.map((row) => row.from));
    return { name, columns: columns.map((column) => ({ name: column.name, dataType: column.type || "TEXT", nullable: !column.notnull, primaryKey: Boolean(column.pk), foreignKey: fk.has(column.name), defaultValue: column.dflt_value })) };
  }
  async tableExists(name: string): Promise<boolean> {
    const row = await this.get<{ count: number }>("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name=?", [name]);
    return row.count > 0;
  }
  previewCreateTable(table: string, columns: ColumnSchema[]): string { return buildCreateTableSql(table, columns, "sqlite"); }
  async createTable(table: string, columns: ColumnSchema[]): Promise<void> { await this.run(this.previewCreateTable(table, columns)); }
  async countRows(table: string): Promise<number> {
    return (await this.get<{ count: number }>(`SELECT COUNT(*) count FROM ${qualifiedIdentifier(table, "sqlite")}`)).count;
  }
  async clearTable(table: string): Promise<void> { await this.run(`DELETE FROM ${qualifiedIdentifier(table, "sqlite")}`); }
  async readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    return this.all(`SELECT * FROM ${qualifiedIdentifier(table, "sqlite")} LIMIT ? OFFSET ?`, [limit, offset]);
  }
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<number> {
    if (!rows.length) return 0;
    const columns = Object.keys(rows[0]!);
    await this.run("BEGIN");
    try {
      for (const row of rows) {
        await this.run(`INSERT INTO ${qualifiedIdentifier(table, "sqlite")} (${columns.map((c) => qualifiedIdentifier(c, "sqlite")).join(",")}) VALUES (${columns.map(() => "?").join(",")})`, columns.map((column) => row[column]));
      }
      await this.run("COMMIT"); return rows.length;
    } catch (error) { await this.run("ROLLBACK"); throw error; }
  }
  async upsertBatch(table: string, rows: Record<string, unknown>[], keyColumns: string[]): Promise<number> {
    if (!rows.length) return 0;
    if (!keyColumns.length) throw new Error("UPsert requiere una clave primaria");
    const columns = Object.keys(rows[0]!);
    const updates = columns.filter((column) => !keyColumns.includes(column))
      .map((column) => `${qualifiedIdentifier(column, "sqlite")}=excluded.${qualifiedIdentifier(column, "sqlite")}`);
    await this.run("BEGIN");
    try {
      for (const row of rows) {
        await this.run(
          `INSERT INTO ${qualifiedIdentifier(table, "sqlite")} (${columns.map((column) => qualifiedIdentifier(column, "sqlite")).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT (${keyColumns.map((column) => qualifiedIdentifier(column, "sqlite")).join(",")}) ${updates.length ? `DO UPDATE SET ${updates.join(",")}` : "DO NOTHING"}`,
          columns.map((column) => row[column])
        );
      }
      await this.run("COMMIT");
      return rows.length;
    } catch (error) {
      await this.run("ROLLBACK");
      throw error;
    }
  }
  async verifyReadPermission(table: string): Promise<void> { await this.all(`SELECT 1 FROM ${qualifiedIdentifier(table, "sqlite")} LIMIT 0`); }
  async verifyWritePermission(table: string, exists: boolean): Promise<void> {
    if (exists) { await this.run("BEGIN"); try { await this.run(`DELETE FROM ${qualifiedIdentifier(table, "sqlite")} WHERE 0`); } finally { await this.run("ROLLBACK"); } }
    else await this.get("PRAGMA query_only");
  }
}
