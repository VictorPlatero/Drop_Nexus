import type { ColumnSchema, ConnectionTest, DbConfiguration, TableSchema } from "../types/index.js";

export interface DatabaseAdapter {
  readonly config: DbConfiguration;
  connect(): Promise<void>;
  close(): Promise<void>;
  testConnection(): Promise<ConnectionTest>;
  listTables(): Promise<string[]>;
  getTableSchema(table: string): Promise<TableSchema>;
  tableExists(table: string): Promise<boolean>;
  previewCreateTable(table: string, columns: ColumnSchema[]): string;
  createTable(table: string, columns: ColumnSchema[]): Promise<void>;
  countRows(table: string): Promise<number>;
  clearTable(table: string): Promise<void>;
  readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]>;
  insertBatch(table: string, rows: Record<string, unknown>[]): Promise<number>;
  upsertBatch(table: string, rows: Record<string, unknown>[], keyColumns: string[]): Promise<number>;
  verifyReadPermission(table: string): Promise<void>;
  verifyWritePermission(table: string, tableExists: boolean): Promise<void>;
}

export function quoteIdentifier(identifier: string, engine: DbConfiguration["engine"]): string {
  if (identifier.includes("\0")) throw new Error("Invalid identifier");
  if (engine === "mysql" || engine === "mariadb") return `\`${identifier.replaceAll("`", "``")}\``;
  if (engine === "sqlserver") return `[${identifier.replaceAll("]", "]]")}]`;
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function splitQualifiedName(name: string): { schema?: string; table: string } {
  const parts = name.split(".");
  return parts.length > 1
    ? { schema: parts.slice(0, -1).join("."), table: parts.at(-1)! }
    : { table: name };
}

export function qualifiedIdentifier(name: string, engine: DbConfiguration["engine"]): string {
  return name.split(".").map((part) => quoteIdentifier(part, engine)).join(".");
}
