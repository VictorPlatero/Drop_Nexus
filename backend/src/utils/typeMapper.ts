import type { ColumnSchema, DbEngine } from "../types/index.js";
import { quoteIdentifier } from "../adapters/DatabaseAdapter.js";

type CanonicalType = "boolean" | "integer" | "bigint" | "decimal" | "datetime" | "binary" | "json" | "uuid" | "text";

function canonical(sourceType: string): CanonicalType {
  const type = sourceType.toLowerCase();
  if (/bool|bit/.test(type)) return "boolean";
  if (/bigint|int8|long/.test(type)) return "bigint";
  if (/tinyint|smallint|integer|int4|int\b/.test(type)) return "integer";
  if (/numeric|decimal|number|real|double|float|money/.test(type)) return "decimal";
  if (/date|time/.test(type)) return "datetime";
  if (/blob|binary|bytea|image/.test(type)) return "binary";
  if (/json|object|array|document/.test(type)) return "json";
  if (/uuid|uniqueidentifier|objectid/.test(type)) return "uuid";
  return "text";
}

const mappings: Record<Exclude<DbEngine, "mongodb">, Record<CanonicalType, string>> = {
  postgresql: {
    boolean: "BOOLEAN", integer: "INTEGER", bigint: "BIGINT", decimal: "NUMERIC",
    datetime: "TIMESTAMPTZ", binary: "BYTEA", json: "JSONB", uuid: "UUID", text: "TEXT"
  },
  mysql: {
    boolean: "BOOLEAN", integer: "INT", bigint: "BIGINT", decimal: "DECIMAL(38,10)",
    datetime: "DATETIME", binary: "LONGBLOB", json: "JSON", uuid: "CHAR(36)", text: "LONGTEXT"
  },
  mariadb: {
    boolean: "BOOLEAN", integer: "INT", bigint: "BIGINT", decimal: "DECIMAL(38,10)",
    datetime: "DATETIME", binary: "LONGBLOB", json: "LONGTEXT", uuid: "CHAR(36)", text: "LONGTEXT"
  },
  sqlserver: {
    boolean: "BIT", integer: "INT", bigint: "BIGINT", decimal: "DECIMAL(38,10)",
    datetime: "DATETIMEOFFSET", binary: "VARBINARY(MAX)", json: "NVARCHAR(MAX)",
    uuid: "UNIQUEIDENTIFIER", text: "NVARCHAR(MAX)"
  },
  oracle: {
    boolean: "NUMBER(1)", integer: "NUMBER(10)", bigint: "NUMBER(19)", decimal: "NUMBER(38,10)",
    datetime: "TIMESTAMP WITH TIME ZONE", binary: "BLOB", json: "CLOB", uuid: "VARCHAR2(36)",
    text: "CLOB"
  },
  sqlite: {
    boolean: "INTEGER", integer: "INTEGER", bigint: "INTEGER", decimal: "REAL",
    datetime: "TEXT", binary: "BLOB", json: "TEXT", uuid: "TEXT", text: "TEXT"
  },
  excel: {
    boolean: "TEXT", integer: "TEXT", bigint: "TEXT", decimal: "TEXT",
    datetime: "TEXT", binary: "TEXT", json: "TEXT", uuid: "TEXT", text: "TEXT"
  }
};

export function mapType(sourceType: string, destination: Exclude<DbEngine, "mongodb">): string {
  return mappings[destination][canonical(sourceType)];
}

export function buildCreateTableSql(
  table: string,
  columns: ColumnSchema[],
  destination: Exclude<DbEngine, "mongodb">
): string {
  if (!columns.length) throw new Error("No se puede crear una tabla sin columnas");
  const definitions = columns.map((column) => {
    const nullable = column.nullable ? "" : " NOT NULL";
    return `  ${quoteIdentifier(column.name, destination)} ${mapType(column.dataType, destination)}${nullable}`;
  });
  const primaryKeys = columns.filter((column) => column.primaryKey);
  if (primaryKeys.length) {
    definitions.push(`  PRIMARY KEY (${primaryKeys.map((column) => quoteIdentifier(column.name, destination)).join(", ")})`);
  }
  return `CREATE TABLE ${table.split(".").map((part) => quoteIdentifier(part, destination)).join(".")} (\n${definitions.join(",\n")}\n);`;
}
