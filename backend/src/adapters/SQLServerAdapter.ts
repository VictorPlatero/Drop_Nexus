import sql from "mssql";
import type { DatabaseAdapter } from "./DatabaseAdapter.js";
import { qualifiedIdentifier, splitQualifiedName } from "./DatabaseAdapter.js";
import type { ColumnSchema, ConnectionTest, DbConfiguration, TableSchema } from "../types/index.js";
import { buildCreateTableSql } from "../utils/typeMapper.js";

export class SQLServerAdapter implements DatabaseAdapter {
  private pool?: sql.ConnectionPool;
  constructor(public readonly config: DbConfiguration) {}
  async connect(): Promise<void> {
    if (this.pool?.connected) return;
    this.pool = await new sql.ConnectionPool({
      server: this.config.host ?? "localhost", port: this.config.port ?? 1433,
      database: this.config.database, user: this.config.username, password: this.config.password,
      connectionTimeout: Number(this.config.options?.connectionTimeoutMs ?? 5000),
      requestTimeout: Number(this.config.options?.requestTimeoutMs ?? 5000),
      options: { encrypt: Boolean(this.config.options?.encrypt), trustServerCertificate: Boolean(this.config.options?.trustServerCertificate) },
      pool: { max: 3, min: 0, idleTimeoutMillis: 30000 }
    }).connect();
  }
  async close(): Promise<void> { await this.pool?.close(); this.pool = undefined; }
  private db(): sql.ConnectionPool { if (!this.pool) throw new Error("Adapter not connected"); return this.pool; }
  async testConnection(): Promise<ConnectionTest> {
    const start = performance.now();
    try { await this.connect(); await this.db().request().query("SELECT 1"); return { ok: true, latencyMs: Math.round(performance.now() - start) }; }
    catch (error) { return { ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "Connection failed" }; }
  }
  async listTables(): Promise<string[]> {
    const result = await this.db().request().query(`SELECT TABLE_SCHEMA + '.' + TABLE_NAME name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY 1`);
    return result.recordset.map((r: { name: string }) => r.name);
  }
  async getTableSchema(name: string): Promise<TableSchema> {
    const { schema = "dbo", table } = splitQualifiedName(name);
    const result = await this.db().request().input("schema", schema).input("table", table).query(`
      SELECT c.COLUMN_NAME column_name, c.DATA_TYPE data_type, c.IS_NULLABLE is_nullable, c.COLUMN_DEFAULT column_default,
      CASE WHEN pk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END pk, CASE WHEN fk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END fk
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME=ku.CONSTRAINT_NAME WHERE tc.CONSTRAINT_TYPE='PRIMARY KEY') pk ON pk.TABLE_SCHEMA=c.TABLE_SCHEMA AND pk.TABLE_NAME=c.TABLE_NAME AND pk.COLUMN_NAME=c.COLUMN_NAME
      LEFT JOIN (SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME=ku.CONSTRAINT_NAME WHERE tc.CONSTRAINT_TYPE='FOREIGN KEY') fk ON fk.TABLE_SCHEMA=c.TABLE_SCHEMA AND fk.TABLE_NAME=c.TABLE_NAME AND fk.COLUMN_NAME=c.COLUMN_NAME
      WHERE c.TABLE_SCHEMA=@schema AND c.TABLE_NAME=@table ORDER BY c.ORDINAL_POSITION`);
    return { name, columns: result.recordset.map((r: { column_name: string; data_type: string; is_nullable: string; pk: number; fk: number; column_default?: string | null }) => ({ name: r.column_name, dataType: r.data_type, nullable: r.is_nullable === "YES", primaryKey: Boolean(r.pk), foreignKey: Boolean(r.fk), defaultValue: r.column_default })) };
  }
  async tableExists(name: string): Promise<boolean> {
    const { schema = "dbo", table } = splitQualifiedName(name);
    const result = await this.db().request().input("schema", schema).input("table", table).query("SELECT COUNT(*) count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=@schema AND TABLE_NAME=@table");
    return result.recordset[0].count > 0;
  }
  previewCreateTable(table: string, columns: ColumnSchema[]): string { return buildCreateTableSql(table, columns, "sqlserver"); }
  async createTable(table: string, columns: ColumnSchema[]): Promise<void> { await this.db().request().query(this.previewCreateTable(table, columns)); }
  async countRows(table: string): Promise<number> {
    const result = await this.db().request().query(`SELECT COUNT_BIG(*) count FROM ${qualifiedIdentifier(table, "sqlserver")}`);
    return Number(result.recordset[0].count);
  }
  async clearTable(table: string): Promise<void> {
    try { await this.db().request().query(`TRUNCATE TABLE ${qualifiedIdentifier(table, "sqlserver")}`); }
    catch { await this.db().request().query(`DELETE FROM ${qualifiedIdentifier(table, "sqlserver")}`); }
  }
  async readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    const result = await this.db().request().input("offset", offset).input("limit", limit).query(`SELECT * FROM ${qualifiedIdentifier(table, "sqlserver")} ORDER BY (SELECT NULL) OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`);
    return result.recordset;
  }
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<number> {
    if (!rows.length) return 0;
    const columns = Object.keys(rows[0]!);
    const transaction = new sql.Transaction(this.db()); await transaction.begin();
    try {
      for (const row of rows) {
        const request = new sql.Request(transaction);
        const params = columns.map((column, index) => { request.input(`p${index}`, row[column] as never); return `@p${index}`; });
        await request.query(`INSERT INTO ${qualifiedIdentifier(table, "sqlserver")} (${columns.map((c) => qualifiedIdentifier(c, "sqlserver")).join(",")}) VALUES (${params.join(",")})`);
      }
      await transaction.commit(); return rows.length;
    } catch (error) { await transaction.rollback(); throw error; }
  }
  async upsertBatch(table: string, rows: Record<string, unknown>[], keyColumns: string[]): Promise<number> {
    if (!rows.length) return 0;
    if (!keyColumns.length) throw new Error("UPsert requiere una clave primaria");
    const columns = Object.keys(rows[0]!);
    const transaction = new sql.Transaction(this.db());
    await transaction.begin();
    try {
      for (const row of rows) {
        const request = new sql.Request(transaction);
        columns.forEach((column, index) => request.input(`p${index}`, row[column] as never));
        const source = columns.map((column, index) => `@p${index} AS ${qualifiedIdentifier(column, "sqlserver")}`).join(",");
        const match = keyColumns.map((column) => `target.${qualifiedIdentifier(column, "sqlserver")}=source.${qualifiedIdentifier(column, "sqlserver")}`).join(" AND ");
        const updates = columns.filter((column) => !keyColumns.includes(column))
          .map((column) => `target.${qualifiedIdentifier(column, "sqlserver")}=source.${qualifiedIdentifier(column, "sqlserver")}`).join(",");
        await request.query(`MERGE ${qualifiedIdentifier(table, "sqlserver")} AS target USING (SELECT ${source}) AS source ON ${match} ${updates ? `WHEN MATCHED THEN UPDATE SET ${updates}` : ""} WHEN NOT MATCHED THEN INSERT (${columns.map((column) => qualifiedIdentifier(column, "sqlserver")).join(",")}) VALUES (${columns.map((column) => `source.${qualifiedIdentifier(column, "sqlserver")}`).join(",")});`);
      }
      await transaction.commit();
      return rows.length;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  async verifyReadPermission(table: string): Promise<void> { await this.db().request().query(`SELECT TOP 0 * FROM ${qualifiedIdentifier(table, "sqlserver")}`); }
  async verifyWritePermission(table: string, exists: boolean): Promise<void> {
    if (exists) await this.db().request().query(`INSERT INTO ${qualifiedIdentifier(table, "sqlserver")} SELECT TOP 0 * FROM ${qualifiedIdentifier(table, "sqlserver")}`);
    else await this.db().request().query("SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE')");
  }
}
