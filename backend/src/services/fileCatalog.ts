import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { Database as SQLiteDatabase } from "sqlite3";
import sql from "mssql";
import type { MultipartFile } from "@fastify/multipart";
import type { ColumnSchema, DbEngine } from "../types/index.js";
import { SQLServerAdapter } from "../adapters/SQLServerAdapter.js";
import { maxDatabaseFileSizeBytes, maxDatabaseFileSizeMb } from "../utils/uploadLimits.js";
import { pool } from "../db/database.js";

const require = createRequire(import.meta.url);

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

export function catalogRoot(): string {
  return catalogRootCandidates()[0]!;
}

function catalogRootCandidates(): string[] {
  return [
    process.env.DATABASE_UPLOAD_DIR,
    process.env.SQLITE_UPLOAD_DIR,
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

async function temporaryUserDirectory(userId: string): Promise<string> {
  const directory = path.join(os.tmpdir(), "drop-nexus", "uploads", String(userId));
  await mkdir(directory, { recursive: true });
  return directory;
}

export function isOwnedCatalogPath(filePath: string, userId: string): boolean {
  if (filePath.startsWith(DATABASE_CATALOG_PREFIX)) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filePath.slice(DATABASE_CATALOG_PREFIX.length));
  }
  const resolved = path.resolve(filePath);
  return catalogRootCandidates().some((root) => resolved.startsWith(`${path.join(root, String(userId))}${path.sep}`));
}

function extensionsFor(engine: DbEngine): string[] {
  if (engine === "sqlite") return [".db", ".sqlite", ".sqlite3"];
  if (engine === "mongodb") return [".json", ".ndjson"];
  if (engine === "excel") return [".xlsx", ".xls", ".csv"];
  if (engine === "sqlserver") return [".sql", ".bak"];
  return [".sql"];
}

export async function isOwnedCatalogReference(filePath: string, userId: string): Promise<boolean> {
  if (!filePath.startsWith(DATABASE_CATALOG_PREFIX)) return isOwnedCatalogPath(filePath, userId);
  const result = await pool.query(
    "SELECT 1 FROM database_catalogs WHERE id=$1 AND user_id=$2",
    [filePath.slice(DATABASE_CATALOG_PREFIX.length), String(userId)]
  );
  return Boolean(result.rowCount);
}

export async function validateOwnedCatalogReference(filePath: string, userId: string, engine: DbEngine): Promise<boolean> {
  if (!await isOwnedCatalogReference(filePath, userId)) return false;
  try {
    const catalog = await readCatalog(filePath);
    return catalog.sourceEngine === engine;
  } catch {
    return false;
  }
}

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const DATABASE_CATALOG_PREFIX = "catalog-db://";
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const MAX_ORIGINAL_NAME_LENGTH = 255;

async function writableBackupDirectory(userId: string): Promise<string> {
  if (!process.env.SQLSERVER_BACKUP_DIR) throw new Error("SQLSERVER_BACKUP_DIR no está configurado");
  const directory = path.join(path.resolve(process.env.SQLSERVER_BACKUP_DIR), String(userId));
  await mkdir(directory, { recursive: true });
  return directory;
}

function validateUploadMetadata(file: MultipartFile, engine: DbEngine): string {
  if (file.fieldname !== "file") throw new Error('El campo multipart debe llamarse "file"');
  const originalName = safeOriginalFileName(file.filename);
  if (!originalName) throw new Error("El archivo no tiene nombre valido");
  if (originalName.length > MAX_ORIGINAL_NAME_LENGTH) throw new Error("El nombre del archivo supera 255 caracteres");
  if (/[\u0000-\u001F<>:"/\\|?*]/.test(originalName)) throw new Error("El nombre del archivo contiene caracteres no permitidos");
  const extension = path.extname(originalName).toLowerCase();
  if (!extension) throw new Error(`El archivo para ${engine} debe tener extension ${extensionsFor(engine).join(", ")}`);
  return originalName;
}

function safeOriginalFileName(fileName: string | undefined): string {
  const trimmed = (fileName ?? "").trim();
  const withoutPosixPath = path.posix.basename(trimmed);
  return path.win32.basename(withoutPosixPath).trim();
}

async function validateStoredUpload(filePath: string, extension: string): Promise<void> {
  const head = await readFileStart(filePath, Math.max(SQLITE_HEADER.length, 4096));
  if (!head.length) throw new Error("El archivo esta vacio");

  if ([".db", ".sqlite", ".sqlite3"].includes(extension)) {
    if (head.length < SQLITE_HEADER.length || !head.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
      throw new Error("El archivo no tiene una cabecera SQLite valida");
    }
    return;
  }

  if (extension === ".bak" || extension === ".xlsx" || extension === ".xls") return;
  if (head.includes(0)) throw new Error("El archivo parece binario. Sube un export compatible con el motor seleccionado");
  const sample = decodeText(head);
  if (!sample.trim()) throw new Error("El archivo no contiene datos legibles");
}

async function readFileStart(filePath: string, length: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function importDatabaseFile(file: MultipartFile, userId: string, engine: DbEngine): Promise<{ catalogPath: string; originalName: string; size: number; tableCount: number }> {
  const originalName = validateUploadMetadata(file, engine);
  const extension = path.extname(originalName).toLowerCase();
  if (!extensionsFor(engine).includes(extension)) {
    throw new Error(`Formato no valido para ${engine}. Usa ${extensionsFor(engine).join(", ")}`);
  }
  if (extension === ".bak") assertBakRestoreConfigured();
  const directory = process.env.NODE_ENV === "production"
    ? await temporaryUserDirectory(userId)
    : await writableUserDirectory(userId);
  const rawDirectory = extension === ".bak" ? await writableBackupDirectory(userId) : directory;
  const rawPath = path.join(rawDirectory, `${randomUUID()}${extension}`);
  let catalogPath = "";
  let size = 0;
  file.file.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxDatabaseFileSizeBytes()) {
      file.file.destroy(new Error(`El archivo supera el límite de ${maxDatabaseFileSizeMb()} MB`));
    }
  });
  try {
    await pipeline(file.file, createWriteStream(rawPath, { flags: "wx" }));
    await validateStoredUpload(rawPath, extension);
    const tables = engine === "sqlite"
      ? await importSQLite(rawPath)
      : engine === "mongodb"
        ? await importMongo(rawPath, extension, path.basename(originalName, extension))
        : engine === "excel"
          ? await importExcel(rawPath)
          : engine === "sqlserver" && extension === ".bak"
            ? await importSqlServerBackup(rawPath)
            : await importSql(rawPath, engine);
    if (!tables.length) throw new Error("No se encontraron tablas o colecciones importables");
    const catalog: FileCatalog = { version: 1, sourceEngine: engine, originalName, tables };
    catalogPath = process.env.NODE_ENV === "production"
      ? await createDatabaseCatalog(userId, catalog)
      : path.join(directory, `${randomUUID()}.catalog.json`);
    if (!catalogPath.startsWith(DATABASE_CATALOG_PREFIX)) await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
    return { catalogPath, originalName: catalog.originalName, size, tableCount: tables.length };
  } catch (error) {
    if (catalogPath) await removeOwnedCatalog(catalogPath, userId).catch(() => undefined);
    throw error;
  } finally {
    await rm(rawPath, { force: true }).catch(() => undefined);
  }
}

async function createDatabaseCatalog(userId: string, catalog: FileCatalog): Promise<string> {
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(catalog), "utf8"));
  const result = await pool.query(
    `INSERT INTO database_catalogs (user_id,original_name,source_engine,catalog_data,size_bytes)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [String(userId), catalog.originalName, catalog.sourceEngine, compressed, compressed.length]
  );
  return `${DATABASE_CATALOG_PREFIX}${result.rows[0].id as string}`;
}

function assertBakRestoreConfigured(): void {
  const required = [
    "SQLSERVER_RESTORE_HOST",
    "SQLSERVER_RESTORE_USER",
    "SQLSERVER_RESTORE_PASSWORD",
    "SQLSERVER_BACKUP_DIR",
    "SQLSERVER_DATA_DIR"
  ].filter((name) => !process.env[name]);
  if (required.length) {
    throw new Error(
      `Los respaldos .bak necesitan un SQL Server de restauración configurado. Faltan: ${required.join(", ")}. ` +
      "También puedes exportar el respaldo como script .sql."
    );
  }
}

function sqlString(value: string): string {
  return `N'${value.replaceAll("'", "''")}'`;
}

async function importSqlServerBackup(filePath: string): Promise<CatalogTable[]> {
  assertBakRestoreConfigured();
  const databaseName = `DropNexus_${randomUUID().replaceAll("-", "")}`;
  const host = process.env.SQLSERVER_RESTORE_HOST!;
  const port = Number(process.env.SQLSERVER_RESTORE_PORT ?? 1433);
  const username = process.env.SQLSERVER_RESTORE_USER!;
  const password = process.env.SQLSERVER_RESTORE_PASSWORD!;
  const dataDirectory = process.env.SQLSERVER_DATA_DIR!;
  const encrypt = process.env.SQLSERVER_RESTORE_ENCRYPT === "true";
  const trustServerCertificate = process.env.SQLSERVER_RESTORE_TRUST_CERT !== "false";
  const requestTimeout = Number(process.env.SQLSERVER_RESTORE_TIMEOUT_MS ?? 300_000);
  const master = await new sql.ConnectionPool({
    server: host,
    port,
    database: "master",
    user: username,
    password,
    connectionTimeout: 15_000,
    requestTimeout,
    options: { encrypt, trustServerCertificate },
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 }
  }).connect();

  let restored = false;
  try {
    const files = await master.request().query(`RESTORE FILELISTONLY FROM DISK = ${sqlString(filePath)}`);
    if (!files.recordset.length) throw new Error("El respaldo .bak no contiene archivos restaurables");
    const moves = files.recordset.map((item: { LogicalName?: string; Type?: string }, index: number) => {
      if (!item.LogicalName) throw new Error("SQL Server no devolvió el nombre lógico de un archivo del respaldo");
      const suffix = item.Type === "L" ? `.log${index}.ldf` : `.data${index}.mdf`;
      return `MOVE ${sqlString(item.LogicalName)} TO ${sqlString(path.join(dataDirectory, `${databaseName}${suffix}`))}`;
    });
    await master.request().query(
      `RESTORE DATABASE [${databaseName}] FROM DISK = ${sqlString(filePath)} WITH ${moves.join(", ")}, RECOVERY`
    );
    restored = true;

    const now = new Date().toISOString();
    const adapter = new SQLServerAdapter({
      id: databaseName,
      userId: "restore",
      name: databaseName,
      engine: "sqlserver",
      host,
      port,
      database: databaseName,
      username,
      password,
      options: { encrypt, trustServerCertificate, connectionTimeoutMs: 15_000, requestTimeoutMs: requestTimeout },
      createdAt: now,
      updatedAt: now,
      expiresAt: now
    });
    await adapter.connect();
    try {
      const tableNames = await adapter.listTables();
      return await Promise.all(tableNames.map(async (name) => {
        const schema = await adapter.getTableSchema(name);
        const rows: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += 5_000) {
          const batch = await adapter.readBatch(name, offset, 5_000);
          rows.push(...batch);
          if (batch.length < 5_000) break;
        }
        return { name, columns: schema.columns, rows };
      }));
    } finally {
      await adapter.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo restaurar el respaldo";
    throw new Error(`No se pudo importar el respaldo SQL Server .bak: ${message}`);
  } finally {
    if (restored) {
      await master.request().query(
        `ALTER DATABASE [${databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${databaseName}]`
      ).catch(() => undefined);
    }
    await master.close();
  }
}

export async function readCatalog(filePath: string): Promise<FileCatalog> {
  if (filePath.startsWith(DATABASE_CATALOG_PREFIX)) {
    const result = await pool.query(
      "SELECT catalog_data FROM database_catalogs WHERE id=$1",
      [filePath.slice(DATABASE_CATALOG_PREFIX.length)]
    );
    if (!result.rows[0]) throw new Error("El catálogo importado no existe. Elimina esta base e importa nuevamente el archivo.");
    try {
      const bytes = await gunzipAsync(result.rows[0].catalog_data as Buffer);
      return JSON.parse(bytes.toString("utf8")) as FileCatalog;
    } catch {
      throw new Error("El catálogo almacenado está dañado. Elimina esta base e importa nuevamente el archivo.");
    }
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as FileCatalog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "El archivo importado ya no existe en el almacenamiento. Probablemente fue guardado en el disco temporal de Render antes de configurar el disco persistente. Elimina esta base e importa nuevamente el archivo."
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error("El catálogo interno de la base está dañado. Elimina esta base e importa nuevamente el archivo original.");
    }
    throw error;
  }
}

export async function writeCatalog(filePath: string, catalog: FileCatalog): Promise<void> {
  if (filePath.startsWith(DATABASE_CATALOG_PREFIX)) {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(catalog), "utf8"));
    const result = await pool.query(
      "UPDATE database_catalogs SET catalog_data=$2,size_bytes=$3,updated_at=now() WHERE id=$1",
      [filePath.slice(DATABASE_CATALOG_PREFIX.length), compressed, compressed.length]
    );
    if (!result.rowCount) throw new Error("El catálogo importado ya no existe");
    return;
  }
  await writeFile(filePath, JSON.stringify(catalog), "utf8");
}

export async function exportCatalog(filePath: string, format: "json" | "xlsx" | "sqlite"): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const catalog = await readCatalog(filePath);
  const baseName = safeDownloadName(catalog.originalName.replace(/\.[^.]+$/, "") || "database");
  if (format === "json") {
    return {
      buffer: Buffer.from(JSON.stringify(catalog, null, 2), "utf8"),
      contentType: "application/json; charset=utf-8",
      filename: `${baseName}-modificada.json`
    };
  }
  if (format === "xlsx") {
    return {
      buffer: catalogToExcel(catalog),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${baseName}-modificada.xlsx`
    };
  }
  return {
    buffer: await catalogToSQLite(catalog),
    contentType: "application/vnd.sqlite3",
    filename: `${baseName}-modificada.sqlite`
  };
}

export async function removeOwnedCatalog(filePath: string | undefined, userId: string): Promise<void> {
  if (filePath?.startsWith(DATABASE_CATALOG_PREFIX)) {
    await pool.query(
      "DELETE FROM database_catalogs WHERE id=$1 AND user_id=$2",
      [filePath.slice(DATABASE_CATALOG_PREFIX.length), String(userId)]
    );
    return;
  }
  if (filePath && isOwnedCatalogPath(filePath, userId)) await rm(filePath, { force: true }).catch(() => undefined);
}

function sqliteAll<T>(db: SQLiteDatabase, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows as T[])));
}

function sqliteRun(db: SQLiteDatabase, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => db.run(sql, params, (error) => error ? reject(error) : resolve()));
}

async function importSQLite(filePath: string): Promise<CatalogTable[]> {
  const sqlite3 = loadSqlite3();
  const db = await new Promise<SQLiteDatabase>((resolve, reject) => {
    const database = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (error: Error | null) => error ? reject(error) : resolve(database));
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

async function importMongo(filePath: string, extension: string, fallbackName: string): Promise<CatalogTable[]> {
  const text = await readTextFile(filePath);
  if (!text.trim()) throw new Error("El archivo MongoDB esta vacio");
  const parsed = parseMongoExport(text, extension);
  const collections = normalizeMongoCollections(parsed, fallbackName || "coleccion");
  return Object.entries(collections).map(([name, rows]) => ({
    name,
    columns: inferColumns(rows),
    rows
  }));
}

function parseMongoExport(text: string, extension: string): unknown {
  try {
    if (extension !== ".ndjson") return JSON.parse(text);
    return text.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as unknown];
      } catch (error) {
        const message = error instanceof Error ? error.message : "JSON invalido";
        throw new Error(`NDJSON invalido en la linea ${index + 1}: ${message}`);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NDJSON invalido")) throw error;
    throw new Error(`JSON invalido: ${error instanceof Error ? error.message : "no se pudo interpretar"}`);
  }
}

function normalizeMongoCollections(parsed: unknown, fallbackName: string): Record<string, Record<string, unknown>[]> {
  if (Array.isArray(parsed)) return { [fallbackName]: ensureObjectRows(parsed, fallbackName) };
  if (!isRecord(parsed)) throw new Error("El export MongoDB debe ser un objeto, un arreglo de documentos o NDJSON");
  const values = Object.values(parsed);
  if (values.some((value) => !Array.isArray(value) && !isRecord(value))) {
    return { [fallbackName]: ensureObjectRows([parsed], fallbackName) };
  }
  return Object.fromEntries(Object.entries(parsed).map(([name, value]) => [
    name,
    ensureObjectRows(Array.isArray(value) ? value : [value], name)
  ]));
}

function ensureObjectRows(rows: unknown[], collectionName: string): Record<string, unknown>[] {
  if (!rows.length) throw new Error(`La coleccion ${collectionName} no contiene documentos`);
  return rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`La coleccion ${collectionName} contiene un documento no valido en la posicion ${index + 1}`);
    return row;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectSqlEngine(sql: string): DbEngine | undefined {
  const sample = sql.slice(0, 256 * 1024).toLowerCase();
  const scores: Partial<Record<DbEngine, number>> = {
    postgresql: 0,
    mysql: 0,
    mariadb: 0,
    sqlserver: 0,
    oracle: 0
  };
  const score = (engine: DbEngine, pattern: RegExp, points: number) => {
    scores[engine] = (scores[engine] ?? 0) + (pattern.test(sample) ? points : 0);
  };

  score("postgresql", /postgresql database dump|pg_dump|set statement_timeout|set search_path|copy\s+.+\s+from stdin|::regclass/, 4);
  score("postgresql", /\bserial\b|\bbigserial\b|\bbytea\b|\bjsonb\b/, 2);
  score("mysql", /mysql dump|mysqldump|set @old_|lock tables|unlock tables|engine\s*=\s*(innodb|myisam)/, 4);
  score("mysql", /`[^`]+`|\bauto_increment\b|\bunsigned\b/, 2);
  score("mariadb", /mariadb dump|mariadb server|mariadb-dump/, 5);
  score("mariadb", /engine\s*=\s*aria|\bsequence\b/, 2);
  score("sqlserver", /sql server|microsoft sql|set ansi_nulls|set quoted_identifier|\bgo\s*(?:\r?\n|$)|\bnvarchar\b|\buniqueidentifier\b|\bidentity\s*\(/m, 4);
  score("sqlserver", /\[[^\]]+\]\.\[[^\]]+\]|\bdatetime2\b|\bvarbinary\(max\)/, 2);
  score("oracle", /oracle database|sql\*plus|rem inserting into|set define off|tablespace\s+["\w]/, 5);
  score("oracle", /\bvarchar2\s*\(|\bnvarchar2\s*\(|\bnumber\s*(?:\(|\b)|\bto_date\s*\(|\bto_timestamp\s*\(|\bclob\b|\braw\s*\(/, 4);
  score("oracle", /\bsequence\b|\bsysdate\b|\bdual\b|\bpls_integer\b/, 2);

  const ranked = Object.entries(scores).sort((a, b) => Number(b[1]) - Number(a[1])) as Array<[DbEngine, number]>;
  const first = ranked[0];
  if (!first) return undefined;
  const [best, bestScore] = first;
  const secondScore = ranked[1]?.[1] ?? 0;
  return bestScore >= 4 && bestScore > secondScore ? best : undefined;
}

function displayEngine(engine: DbEngine): string {
  const names: Record<DbEngine, string> = {
    postgresql: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MariaDB",
    sqlserver: "SQL Server",
    oracle: "Oracle",
    sqlite: "SQLite",
    mongodb: "MongoDB",
    excel: "Excel"
  };
  return names[engine];
}

function loadXlsx(): any {
  try {
    return require("xlsx");
  } catch {
    throw new Error("Soporte Excel no instalado. Ejecuta npm install en backend para instalar xlsx.");
  }
}

function loadSqlite3(): any {
  try {
    return require("sqlite3");
  } catch {
    throw new Error("Soporte SQLite no instalado correctamente. Ejecuta npm install en backend para compilar sqlite3.");
  }
}

async function importExcel(filePath: string): Promise<CatalogTable[]> {
  const XLSX = loadXlsx();
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("El archivo Excel no contiene hojas");
  const tables = workbook.SheetNames.map((sheetName: string): CatalogTable | null => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
    const headerIndex = matrix.findIndex((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""));
    if (headerIndex < 0) return null;
    const headers = uniqueColumnNames(matrix[headerIndex]!
      .map((cell, index) => normalizeColumnName(cell, index))
      .filter(Boolean));
    if (!headers.length) return null;
    const rows = matrix.slice(headerIndex + 1)
      .filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
    return {
      name: sheetName,
      columns: inferColumnsFromHeaders(headers, rows),
      rows
    };
  }).filter((table: CatalogTable | null): table is CatalogTable => Boolean(table));
  if (!tables.length) throw new Error("El archivo Excel no tiene hojas con encabezados o datos importables");
  return tables;
}

function catalogToExcel(catalog: FileCatalog): Buffer {
  const XLSX = loadXlsx();
  const workbook = XLSX.utils.book_new();
  for (const [index, table] of catalog.tables.entries()) {
    const columns = columnsForExport(table);
    if (!columns.length) continue;
    const rows = table.rows.length
      ? table.rows.map((row) => Object.fromEntries(columns.map((column) => [column, serializeCell(row[column])])))
      : [Object.fromEntries(columns.map((column) => [column, null]))];
    const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
    XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(table.name, index));
  }
  if (!workbook.SheetNames.length) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Sin datos"]]), "Base");
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function catalogToSQLite(catalog: FileCatalog): Promise<Buffer> {
  const directory = path.join(os.tmpdir(), "drop-nexus", "exports");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${randomUUID()}.sqlite`);
  const sqlite3 = loadSqlite3();
  const db = await new Promise<SQLiteDatabase>((resolve, reject) => {
    const database = new sqlite3.Database(filePath, (error: Error | null) => error ? reject(error) : resolve(database));
  });
  try {
    for (const table of catalog.tables) {
      const columns = columnsForExport(table);
      if (!columns.length) continue;
      const tableName = quoteSQLiteIdentifier(table.name);
      await sqliteRun(db, `CREATE TABLE ${tableName} (${columns.map((column) => `${quoteSQLiteIdentifier(column)} ${sqliteType(table.columns.find((item) => item.name === column)?.dataType ?? "TEXT")}`).join(", ")})`);
      const insert = `INSERT INTO ${tableName} (${columns.map(quoteSQLiteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      for (const row of table.rows) {
        await sqliteRun(db, insert, columns.map((column) => serializeCell(row[column])));
      }
    }
  } finally {
    await new Promise<void>((resolve) => db.close(() => resolve()));
  }
  try {
    return await readFile(filePath);
  } finally {
    await rm(filePath, { force: true }).catch(() => undefined);
  }
}

function normalizeColumnName(value: unknown, index: number): string {
  const text = String(value ?? "").trim();
  return text || `columna_${index + 1}`;
}

function uniqueColumnNames(values: string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = value || `columna_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function inferColumnsFromHeaders(headers: string[], rows: Record<string, unknown>[]): ColumnSchema[] {
  return headers.map((name) => {
    const values = rows.map((row) => row[name]).filter((value) => value !== undefined && value !== null && value !== "");
    const sample = values[0];
    const dataType = sample instanceof Date ? "date" : typeof sample === "number" ? "number" : typeof sample === "boolean" ? "boolean" : "text";
    return { name, dataType, nullable: values.length < rows.length, primaryKey: false, foreignKey: false };
  });
}

function columnsForExport(table: CatalogTable): string[] {
  const defined = table.columns.map((column) => column.name);
  const fromRows = [...new Set(table.rows.flatMap((row) => Object.keys(row)))];
  return [...new Set([...defined, ...fromRows])];
}

function serializeCell(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return value;
}

function safeSheetName(value: string, index: number): string {
  return value.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Tabla ${index + 1}`;
}

function safeDownloadName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "database";
}

function quoteSQLiteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqliteType(type: string): string {
  const lower = type.toLowerCase();
  if (/int|bool/.test(lower)) return "INTEGER";
  if (/real|float|double|decimal|numeric|number/.test(lower)) return "REAL";
  if (/blob|binary/.test(lower)) return "BLOB";
  return "TEXT";
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

async function importSql(filePath: string, engine: DbEngine): Promise<CatalogTable[]> {
  const sql = await readTextFile(filePath);
  if (!sql.trim()) throw new Error("El script SQL esta vacio");
  const detected = detectSqlEngine(sql);
  if (detected && detected !== engine) {
    throw new Error(`El script parece de ${displayEngine(detected)}. Selecciona ese motor o sube un archivo compatible con ${displayEngine(engine)}`);
  }
  const tables = new Map<string, CatalogTable>();
  const identifier = String.raw`(?:\[[^\]]+\]|"[^"]+"|` + "`[^`]+`" + String.raw`|[\w$#@-]+)`;
  const qualified = String.raw`${identifier}(?:\s*\.\s*${identifier})*`;
  const terminator = String.raw`(?=\s*(?:;|^GO\s*$|(?![\s\S])))`;
  const createPattern = new RegExp(
    String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${qualified})\s*\(([\s\S]*?)\)\s*(?:ON\s+[^;\r\n]+)?${terminator}`,
    "gim"
  );
  for (const match of sql.matchAll(createPattern)) {
    const name = cleanQualifiedIdentifier(match[1]!);
    const body = match[2]!;
    const parts = splitSqlList(body);
    const primary = new Set<string>();
    const foreign = new Set<string>();
    for (const part of parts) {
      const pkMatch = part.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkMatch) splitSqlList(pkMatch[1]!).forEach((column) => primary.add(cleanIdentifier(column)));
      const fkMatch = part.match(/FOREIGN\s+KEY\s*\(([^)]+)\)/i);
      if (fkMatch) splitSqlList(fkMatch[1]!).forEach((column) => foreign.add(cleanIdentifier(column)));
    }
    const columns = parts.flatMap((part): ColumnSchema[] => {
      if (/^\s*(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|KEY|INDEX)\b/i.test(part)) return [];
      const column = part.match(new RegExp(String.raw`^\s*(${identifier})\s+(${identifier}(?:\s*\([^)]*\))?)`, "i"));
      if (!column) return [];
      const columnName = cleanIdentifier(column[1]!);
      return [{
        name: columnName,
        dataType: cleanDataType(column[2]!),
        nullable: !/NOT\s+NULL/i.test(part),
        primaryKey: primary.has(columnName) || /PRIMARY\s+KEY/i.test(part),
        foreignKey: foreign.has(columnName) || /REFERENCES\s+/i.test(part)
      }];
    });
    tables.set(name, { name, columns, rows: [] });
  }
  const insertPattern = new RegExp(
    String.raw`INSERT\s+(?:INTO\s+)?(${qualified})\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]*?)${terminator}`,
    "gim"
  );
  for (const match of sql.matchAll(insertPattern)) {
    const name = cleanQualifiedIdentifier(match[1]!);
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
  return decodeText(await readFile(filePath));
}

function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function cleanIdentifier(value: string): string {
  return value.trim().replace(/^[`"\[]|[`"\]]$/g, "");
}

function cleanQualifiedIdentifier(value: string): string {
  return value.split(".").map(cleanIdentifier).join(".");
}

function cleanDataType(value: string): string {
  return value.trim().replace(/^([`"\[])([^`"\]]+)[`"\]]/, "$2");
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
  if (/^N'.*'$/is.test(trimmed)) return trimmed.slice(2, -1).replaceAll("''", "'");
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'");
  return trimmed;
}
