import type { DatabaseAdapter } from "./DatabaseAdapter.js";
import type { ColumnSchema, ConnectionTest, DbConfiguration, TableSchema } from "../types/index.js";
import { buildCreateTableSql } from "../utils/typeMapper.js";
import { readCatalog, writeCatalog, type FileCatalog } from "../services/fileCatalog.js";

export class FileDatabaseAdapter implements DatabaseAdapter {
  private catalog?: FileCatalog;
  constructor(public readonly config: DbConfiguration) {}

  async connect(): Promise<void> {
    if (!this.config.database) throw new Error("Archivo de base de datos no disponible");
    this.catalog = await readCatalog(this.config.database);
  }
  async close(): Promise<void> { this.catalog = undefined; }
  private data(): FileCatalog { if (!this.catalog) throw new Error("Archivo no conectado"); return this.catalog; }
  private table(name: string) {
    const table = this.data().tables.find((item) => item.name === name);
    if (!table) throw new Error(`Tabla o colección ${name} no encontrada`);
    return table;
  }
  async testConnection(): Promise<ConnectionTest> {
    const start = performance.now();
    try { await this.connect(); return { ok: true, latencyMs: Math.round(performance.now() - start) }; }
    catch (error) { return { ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "Archivo inválido" }; }
  }
  async listTables(): Promise<string[]> { return this.data().tables.map((table) => table.name); }
  async getTableSchema(name: string): Promise<TableSchema> { return { name, columns: this.table(name).columns }; }
  async tableExists(name: string): Promise<boolean> { return this.data().tables.some((table) => table.name === name); }
  previewCreateTable(table: string, columns: ColumnSchema[]): string {
    if (this.config.engine === "mongodb") return JSON.stringify({ create: table, fields: columns }, null, 2);
    if (this.config.engine === "excel") return `Se creara una hoja "${table}" con columnas: ${columns.map((column) => column.name).join(", ")}`;
    return buildCreateTableSql(table, columns, this.config.engine);
  }
  async createTable(name: string, columns: ColumnSchema[]): Promise<void> {
    if (!this.config.database) throw new Error("Archivo no disponible");
    this.data().tables.push({ name, columns, rows: [] });
    await writeCatalog(this.config.database, this.data());
  }
  async countRows(name: string): Promise<number> { return this.table(name).rows.length; }
  async clearTable(name: string): Promise<void> {
    if (!this.config.database) throw new Error("Archivo no disponible");
    this.table(name).rows = [];
    await writeCatalog(this.config.database, this.data());
  }
  async readBatch(name: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    return this.table(name).rows.slice(offset, offset + limit);
  }
  async insertBatch(name: string, rows: Record<string, unknown>[]): Promise<number> {
    if (!this.config.database) throw new Error("Archivo no disponible");
    this.table(name).rows.push(...rows);
    await writeCatalog(this.config.database, this.data());
    return rows.length;
  }
  async upsertBatch(name: string, rows: Record<string, unknown>[], keyColumns: string[]): Promise<number> {
    if (!this.config.database) throw new Error("Archivo no disponible");
    if (!keyColumns.length) throw new Error("UPsert requiere una clave primaria");
    const table = this.table(name);
    const key = (row: Record<string, unknown>) => JSON.stringify(keyColumns.map((column) => row[column]));
    const indexes = new Map(table.rows.map((row, index) => [key(row), index]));
    for (const row of rows) {
      const existing = indexes.get(key(row));
      if (existing === undefined) {
        indexes.set(key(row), table.rows.length);
        table.rows.push(row);
      } else {
        table.rows[existing] = { ...table.rows[existing], ...row };
      }
    }
    await writeCatalog(this.config.database, this.data());
    return rows.length;
  }
  async verifyReadPermission(name: string): Promise<void> { this.table(name); }
  async verifyWritePermission(name: string, exists: boolean): Promise<void> { if (exists) this.table(name); }
}
