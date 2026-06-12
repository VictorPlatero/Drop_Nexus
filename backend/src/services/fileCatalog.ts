import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import sqlite3 from "sqlite3";
import type { MultipartFile } from "@fastify/multipart";
import type { ColumnSchema, DbEngine } from "../types/index.js";

export interface CatalogTable {
  name: string;
  columns: ColumnSchema[];
  rows: Record<string, unknown>[];
}

export interface FileCatalog {
  version: 1;
  sourceEngine: DbEngine;
  originalName: string;
  tables: CatalogTable[];
}

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export function catalogRoot(): string {
  return catalogRootCandidates()[0]!;
}

function catalogRootCandidates(): string[] {
  return [
    process.env.DATABASE_UPLOAD_DIR,
    process.env.SQLITE_UPLOAD_DIR,
    process.env.NODE_ENV === "production" ? "/var/data/databases" : undefined,
    path.join(process.cwd(), "storage", "databases"),
    path.join(os.tmpdir(), "drop-nexus", "databases")
  ].filter((value): value is string => Boolean(value)).map((value) => path.resolve(value));
}

async function writableUserDirectory(userId: string): Promise<string> {
  const errors: string[] = [];
  for (const root of catalogRootCandidates()) {
    const directory = path.join(root, String(userId));
    try {
      await mkdir(directory, { recursive: true });
      return directory;
    } catch (error) {
      errors.push(`${root}: ${error instanceof Error ? error.message : "no escribible"}`);
    }
  }
  throw new Error(`No hay un directorio escribible para almacenar bases importadas. ${errors.join(" | ")}`);
}

export function isOwnedCatalogPath(filePath: string, userId: string): boolean {
  const resolved = path.resolve(filePath);
  return catalogRootCandidates().some((root) => resolved.startsWith(`${path.join(root, String(userId))}${path.sep}`));
}

function extensionsFor(engine: DbEngine): string[] {
  if (engine === "sqlite") return [".db", ".sqlite", ".sqlite3"];
  if (engine === "mongodb") return [".json", ".ndjson"];
  return [".sql"];
}

export async function importDatabaseFile(file: MultipartFile, userId: string, engine: DbEngine): Promise<{ catalogPath: string; originalName: string; size: number; tableCount: number }> {
  const extension = path.extname(file.filename).toLowerCase();
  if (!extensionsFor(engine).includes(extension)) {
    throw new Error(`Formato no válido para ${engine}. Usa ${extensionsFor(engine).join(", ")}`);
  }
  const directory = await writableUserDirectory(userId);
  const rawPath = path.join(directory, `${randomUUID()}${extension}`);
  const catalogPath = path.join(directory, `${randomUUID()}.catalog.json`);
  let size = 0;
  file.file.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_FILE_SIZE) file.file.destroy(new Error("El archivo supera el límite de 100 MB"));
  });
  try {
    await pipeline(file.file, createWriteStream(rawPath, { flags: "wx" }));
    const tables = engine === "sqlite"
      ? await importSQLite(rawPath)
      : engine === "mongodb"
        ? await importMongo(rawPath, extension)
        : await importSql(rawPath);
    if (!tables.length) throw new Error("No se encontraron tablas o colecciones importables");
    const catalog: FileCatalog = { version: 1, sourceEngine: engine, originalName: path.basename(file.filename), tables };
    await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
    return { catalogPath, originalName: catalog.originalName, size, tableCount: tables.length };
  } catch (error) {
    await rm(catalogPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await rm(rawPath, { force: true }).catch(() => undefined);
  }
}

export async function readCatalog(filePath: string): Promise<FileCatalog> {
  return JSON.parse(await readFile(filePath, "utf8")) as FileCatalog;
}

export async function writeCatalog(filePath: string, catalog: FileCatalog): Promise<void> {
  await writeFile(filePath, JSON.stringify(catalog), "utf8");
}

export async function removeOwnedCatalog(filePath: string | undefined, userId: string): Promise<void> {
  if (filePath && isOwnedCatalogPath(filePath, userId)) await rm(filePath, { force: true }).catch(() => undefined);
}

function sqliteAll<T>(db: sqlite3.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows as T[])));
}

async function importSQLite(filePath: string): Promise<CatalogTable[]> {
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const database = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (error) => error ? reject(error) : resolve(database));
  });
  try {
    const tableRows = await sqliteAll<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    return await Promise.all(tableRows.map(async ({ name }) => {
      const safe = `"${name.replaceAll('"', '""')}"`;
      const columns = await sqliteAll<{ name: string; type: string; notnull: number; pk: number }>(db, `PRAGMA table_info(${safe})`);
      const foreign = await sqliteAll<{ from: string }>(db, `PRAGMA foreign_key_list(${safe})`);
      const fk = new Set(foreign.map((item) => item.from));
      return {
        name,
        columns: columns.map((column) => ({
          name: column.name,
          dataType: column.type || "TEXT",
          nullable: !column.notnull,
          primaryKey: Boolean(column.pk),
          foreignKey: fk.has(column.name)
        })),
        rows: await sqliteAll<Record<string, unknown>>(db, `SELECT * FROM ${safe}`)
      };
    }));
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()));
  }
}

async function importMongo(filePath: string, extension: string): Promise<CatalogTable[]> {
  const text = await readTextFile(filePath);
  const parsed = extension === ".ndjson"
    ? text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : JSON.parse(text);
  const collections: Record<string, Record<string, unknown>[]> = Array.isArray(parsed)
    ? { [path.basename(filePath, extension)]: parsed }
    : Object.fromEntries(Object.entries(parsed).map(([name, value]) => [name, Array.isArray(value) ? value : [value]]));
  return Object.entries(collections).map(([name, rows]) => ({
    name,
    columns: inferColumns(rows),
    rows
  }));
}

function inferColumns(rows: Record<string, unknown>[]): ColumnSchema[] {
  const names = new Set(rows.flatMap((row) => Object.keys(row)));
  return [...names].map((name) => {
    const values = rows.map((row) => row[name]).filter((value) => value !== undefined && value !== null);
    const sample = values[0];
    const dataType = Array.isArray(sample) ? "array" : sample instanceof Date ? "date" : typeof sample === "object" ? "object" : typeof sample;
    return { name, dataType, nullable: values.length < rows.length, primaryKey: name === "_id", foreignKey: false };
  });
}

async function importSql(filePath: string): Promise<CatalogTable[]> {
  const sql = await readTextFile(filePath);
  const tables = new Map<string, CatalogTable>();
  const createPattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w$]+\.)?[`"\[]?([\w$.-]+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi;
  for (const match of sql.matchAll(createPattern)) {
    const name = match[1]!;
    const body = match[2]!;
    const parts = splitSqlList(body);
    const primary = new Set<string>();
    for (const part of parts) {
      const pkMatch = part.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkMatch) splitSqlList(pkMatch[1]!).forEach((column) => primary.add(cleanIdentifier(column)));
    }
    const columns = parts.flatMap((part): ColumnSchema[] => {
      if (/^\s*(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|KEY|INDEX)\b/i.test(part)) return [];
      const column = part.match(/^\s*[`"\[]?([^`"\]\s]+)[`"\]]?\s+([A-Za-z]+(?:\s*\([^)]*\))?)/);
      if (!column) return [];
      const columnName = cleanIdentifier(column[1]!);
      return [{
        name: columnName,
        dataType: column[2]!,
        nullable: !/NOT\s+NULL/i.test(part),
        primaryKey: primary.has(columnName) || /PRIMARY\s+KEY/i.test(part),
        foreignKey: /REFERENCES\s+/i.test(part)
      }];
    });
    tables.set(name, { name, columns, rows: [] });
  }
  const insertPattern = /INSERT\s+INTO\s+(?:[\w$]+\.)?[`"\[]?([\w$.-]+)[`"\]]?\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]*?);/gi;
  for (const match of sql.matchAll(insertPattern)) {
    const name = match[1]!;
    const table = tables.get(name) ?? { name, columns: [], rows: [] };
    const columns = match[2] ? splitSqlList(match[2]).map(cleanIdentifier) : table.columns.map((column) => column.name);
    for (const group of splitValueGroups(match[3]!)) {
      const values = splitSqlList(group).map(parseSqlValue);
      table.rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null])));
    }
    if (!table.columns.length && columns.length) table.columns = inferColumns(table.rows);
    tables.set(name, table);
  }
  return [...tables.values()];
}

async function readTextFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function cleanIdentifier(value: string): string {
  return value.trim().replace(/^[`"\[]|[`"\]]$/g, "");
}

function splitSqlList(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== "\\") quote = "";
    } else if (char === "'" || char === '"') {
      quote = char; current += char;
    } else if (char === "(") {
      depth++; current += char;
    } else if (char === ")") {
      depth--; current += char;
    } else if (char === "," && depth === 0) {
      result.push(current.trim()); current = "";
    } else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function splitValueGroups(value: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let quote = "";
  let start = -1;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = "";
    } else if (char === "'") quote = char;
    else if (char === "(") { if (depth++ === 0) start = index + 1; }
    else if (char === ")" && --depth === 0 && start >= 0) groups.push(value.slice(start, index));
  }
  return groups;
}

function parseSqlValue(value: string): unknown {
  const trimmed = value.trim();
  if (/^NULL$/i.test(trimmed)) return null;
  if (/^(TRUE|FALSE)$/i.test(trimmed)) return /^TRUE$/i.test(trimmed);
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}
