import { randomUUID } from "node:crypto";
import { pool } from "../db/database.js";
import type { DatabaseAdapter } from "../adapters/DatabaseAdapter.js";
import { createAdapter } from "./connectionManager.js";
import { getConfiguration } from "./dbConfigService.js";
import { logger } from "../utils/logger.js";
import type { ReplicationRequest } from "../validations/replicationValidation.js";

type WriteMode = "insert" | "upsert" | "replace" | "truncate";
type Transform = "none" | "string" | "number" | "boolean" | "date" | "json";
interface ColumnMapping { source: string; destination: string; transform: Transform }
interface TableMapping { sourceTable: string; destinationTable: string; columnMappings?: ColumnMapping[] }
interface JobOptions {
  writeMode: WriteMode;
  batchSize: number;
  maxRetries: number;
  createDestination: boolean;
  columnMappings: ColumnMapping[];
  incremental: boolean;
  scheduleMinutes?: number;
}
interface FailureDiagnosis {
  code: string;
  stage: string;
  cause: string;
  recommendation: string;
}

const activeJobs = new Map<string, AbortController>();
let schedulerStarted = false;

function tableMappings(input: ReplicationRequest): TableMapping[] {
  return input.tables ?? [{
    sourceTable: input.sourceTable!,
    destinationTable: input.destinationTable!,
    columnMappings: input.columnMappings
  }];
}

function diagnoseFailure(error: unknown, stage: string, sourceTable?: string): FailureDiagnosis {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("inconsistent types deduced") || lower.includes("could not determine data type")) {
    return {
      code: "METADATA_PARAMETER_TYPE",
      stage,
      cause: "La base de metadatos no pudo determinar el tipo de un parámetro interno.",
      recommendation: "Actualiza la aplicación a la versión corregida y vuelve a ejecutar la replicación."
    };
  }
  if (lower.includes("duplicate") || lower.includes("unique constraint") || lower.includes("duplicate key")) {
    return {
      code: "DUPLICATE_KEY",
      stage,
      cause: "El destino ya contiene una clave única o primaria con el mismo valor.",
      recommendation: "Utiliza el modo Upsert, limpia la tabla destino o corrige las claves duplicadas."
    };
  }
  if (lower.includes("foreign key") || lower.includes("referential")) {
    return {
      code: "FOREIGN_KEY",
      stage,
      cause: "Un registro referencia una fila que todavía no existe en la tabla relacionada.",
      recommendation: "Replica primero las tablas padre o incluye todas las tablas relacionadas en el mismo flujo."
    };
  }
  if (lower.includes("null") && (lower.includes("constraint") || lower.includes("not null"))) {
    return {
      code: "REQUIRED_VALUE",
      stage,
      cause: "Una columna obligatoria recibió un valor vacío.",
      recommendation: "Mapea una columna de origen válida, permite NULL en el destino o completa los datos faltantes."
    };
  }
  if (lower.includes("convert") || lower.includes("invalid input") || lower.includes("out of range") || lower.includes("truncat")) {
    return {
      code: "TYPE_CONVERSION",
      stage,
      cause: "Uno o más valores no son compatibles con el tipo de la columna destino.",
      recommendation: "Revisa el mapeo y aplica una conversión de texto, número, fecha, booleano o JSON."
    };
  }
  if (lower.includes("does not exist") || lower.includes("no existe") || lower.includes("not found")) {
    return {
      code: "MISSING_STRUCTURE",
      stage,
      cause: `No se encontró ${sourceTable ? `la tabla ${sourceTable}` : "una tabla o archivo requerido"}.`,
      recommendation: "Vuelve a importar el archivo correcto y verifica los nombres de tablas seleccionados."
    };
  }
  if (lower.includes("timeout") || lower.includes("tiempo de conexión") || lower.includes("econn")) {
    return {
      code: "CONNECTION_TIMEOUT",
      stage,
      cause: "La conexión con una de las bases expiró o fue interrumpida.",
      recommendation: "Comprueba red, credenciales y disponibilidad del motor; luego usa Continuar."
    };
  }
  if (lower.includes("permission") || lower.includes("denied") || lower.includes("permiso")) {
    return {
      code: "INSUFFICIENT_PERMISSION",
      stage,
      cause: "El usuario de conexión no tiene permisos suficientes para leer o escribir.",
      recommendation: "Concede SELECT al origen y CREATE/INSERT/UPDATE al destino."
    };
  }
  if (lower.includes("clave primaria") || lower.includes("primary key")) {
    return {
      code: "PRIMARY_KEY_REQUIRED",
      stage,
      cause: "El modo Upsert necesita una clave primaria para identificar cada registro.",
      recommendation: "Define una clave primaria o cambia el modo de escritura a Insertar o Reemplazar."
    };
  }
  return {
    code: "UNCLASSIFIED_ERROR",
    stage,
    cause: message,
    recommendation: "Descarga el reporte, revisa el detalle técnico y vuelve a intentar después de corregir la causa indicada."
  };
}

async function prepare(userId: string, sourceConfigId: string, destinationConfigId: string, mapping: TableMapping) {
  const [source, destination] = await Promise.all([
    getConfiguration(sourceConfigId, userId),
    getConfiguration(destinationConfigId, userId)
  ]);
  if (!source || !destination) throw new Error("Configuración de origen o destino no encontrada");
  const sourceAdapter = createAdapter(source);
  const destinationAdapter = createAdapter(destination);
  await Promise.all([sourceAdapter.connect(), destinationAdapter.connect()]);
  try {
    await sourceAdapter.verifyReadPermission(mapping.sourceTable);
    const schema = await sourceAdapter.getTableSchema(mapping.sourceTable);
    const exists = await destinationAdapter.tableExists(mapping.destinationTable);
    await destinationAdapter.verifyWritePermission(mapping.destinationTable, exists);
    const totalRecords = await sourceAdapter.countRows(mapping.sourceTable);
    return { sourceAdapter, destinationAdapter, schema, exists, totalRecords };
  } catch (error) {
    await Promise.allSettled([sourceAdapter.close(), destinationAdapter.close()]);
    throw error;
  }
}

function mappedColumns(columns: Awaited<ReturnType<DatabaseAdapter["getTableSchema"]>>["columns"], mappings: ColumnMapping[]) {
  if (!mappings.length) return columns;
  const map = new Map(mappings.map((mapping) => [mapping.source, mapping.destination]));
  return columns.filter((column) => map.has(column.name)).map((column) => ({ ...column, name: map.get(column.name)! }));
}

export async function previewReplication(userId: string, input: ReplicationRequest) {
  const previews = [];
  for (const mapping of tableMappings(input)) {
    const prepared = await prepare(userId, input.sourceConfigId, input.destinationConfigId, mapping);
    try {
      const columnMappings = mapping.columnMappings ?? input.columnMappings;
      const destinationColumns = mappedColumns(prepared.schema.columns, columnMappings);
      const destinationSchema = prepared.exists
        ? await prepared.destinationAdapter.getTableSchema(mapping.destinationTable)
        : null;
      const warnings: string[] = [];
      if (input.writeMode === "upsert" && !destinationColumns.some((column) => column.primaryKey)) {
        warnings.push("UPsert necesita una clave primaria detectada");
      }
      if (prepared.totalRecords === 0) {
        warnings.push(`La tabla ${mapping.sourceTable} no contiene registros. El archivo puede incluir solo CREATE TABLE o tener los INSERT en otro archivo.`);
      }
      if (destinationSchema) {
        const destinationNames = new Set(destinationSchema.columns.map((column) => column.name));
        const missing = destinationColumns.filter((column) => !destinationNames.has(column.name));
        if (missing.length) warnings.push(`Columnas inexistentes en destino: ${missing.map((column) => column.name).join(", ")}`);
      }
      previews.push({
        sourceTable: mapping.sourceTable,
        destinationTable: mapping.destinationTable,
        tableExists: prepared.exists,
        requiresCreation: !prepared.exists,
        createStatement: prepared.exists ? null : prepared.destinationAdapter.previewCreateTable(mapping.destinationTable, destinationColumns),
        schema: { ...prepared.schema, columns: destinationColumns },
        totalRecords: prepared.totalRecords,
        warnings
      });
    } finally {
      await Promise.allSettled([prepared.sourceAdapter.close(), prepared.destinationAdapter.close()]);
    }
  }
  return {
    previews,
    requiresCreation: previews.some((preview) => preview.requiresCreation),
    createStatement: previews.find((preview) => preview.createStatement)?.createStatement ?? null,
    totalRecords: previews.reduce((total, preview) => total + preview.totalRecords, 0),
    warnings: previews.flatMap((preview) => preview.warnings)
  };
}

export async function startReplication(userId: string, input: ReplicationRequest) {
  const groupId = randomUUID();
  const ids: string[] = [];
  for (const mapping of tableMappings(input)) {
    const options: JobOptions = {
      writeMode: input.writeMode,
      batchSize: input.batchSize,
      maxRetries: input.maxRetries,
      createDestination: input.createDestination,
      columnMappings: mapping.columnMappings ?? input.columnMappings,
      incremental: input.incremental,
      scheduleMinutes: input.scheduleMinutes
    };
    const result = await pool.query(
      `INSERT INTO replications
       (group_id,user_id,source_config_id,destination_config_id,source_table,destination_table,status,options,next_run_at,started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) RETURNING id`,
      [
        groupId, userId, input.sourceConfigId, input.destinationConfigId,
        mapping.sourceTable, mapping.destinationTable,
        input.scheduleMinutes ? "scheduled" : "starting",
        JSON.stringify(options),
        input.scheduleMinutes ? new Date(Date.now() + input.scheduleMinutes * 60_000) : null
      ]
    );
    const id = result.rows[0].id as string;
    ids.push(id);
    if (!input.scheduleMinutes) void executeStoredJob(id);
  }
  return { groupId, ids, status: input.scheduleMinutes ? "scheduled" : "starting" };
}

function transformValue(value: unknown, transform: Transform): unknown {
  if (value === null || value === undefined || transform === "none") return value;
  if (transform === "string") return typeof value === "object" ? JSON.stringify(value) : String(value);
  if (transform === "number") {
    const converted = Number(value);
    if (!Number.isFinite(converted)) throw new Error(`No se puede convertir "${String(value)}" a número`);
    return converted;
  }
  if (transform === "boolean") return typeof value === "string" ? ["true", "1", "sí", "si"].includes(value.toLowerCase()) : Boolean(value);
  if (transform === "date") {
    const date = new Date(value as string | number);
    if (Number.isNaN(date.getTime())) throw new Error(`No se puede convertir "${String(value)}" a fecha`);
    return date;
  }
  if (transform === "json") return typeof value === "string" ? JSON.parse(value) : value;
  return value;
}

function mapRows(rows: Record<string, unknown>[], mappings: ColumnMapping[], destination: DatabaseAdapter) {
  return rows.map((row) => {
    const selected = mappings.length
      ? Object.fromEntries(mappings.map((mapping) => [mapping.destination, transformValue(row[mapping.source], mapping.transform)]))
      : row;
    return Object.fromEntries(Object.entries(selected).map(([key, value]) => {
      if (destination.config.engine !== "mongodb" && value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Date)) {
        if ("toHexString" in value && typeof value.toHexString === "function") return [key, value.toHexString()];
        return [key, JSON.stringify(value)];
      }
      return [key, value];
    }));
  });
}

async function executeStoredJob(id: string) {
  if (activeJobs.has(id)) return;
  const row = (await pool.query("SELECT * FROM replications WHERE id=$1", [id])).rows[0];
  if (!row) return;
  const savedOptions = (row.options ?? {}) as Partial<JobOptions>;
  const options: JobOptions = {
    writeMode: savedOptions.writeMode ?? "insert",
    batchSize: savedOptions.batchSize ?? 1000,
    maxRetries: savedOptions.maxRetries ?? 3,
    createDestination: savedOptions.createDestination ?? false,
    columnMappings: savedOptions.columnMappings ?? [],
    incremental: savedOptions.incremental ?? true,
    scheduleMinutes: savedOptions.scheduleMinutes
  };
  const mapping = { sourceTable: row.source_table as string, destinationTable: row.destination_table as string, columnMappings: options.columnMappings };
  let prepared: Awaited<ReturnType<typeof prepare>>;
  let stage = "preparación";
  try {
    prepared = await prepare(row.user_id, row.source_config_id, row.destination_config_id, mapping);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron preparar las conexiones";
    const diagnosis = diagnoseFailure(error, stage, mapping.sourceTable);
    await pool.query(
      "UPDATE replications SET status='failed',last_error=$2,failure_stage=$3,failure_code=$4,failure_cause=$5,recommendation=$6,stopped_at=now(),updated_at=now() WHERE id=$1",
      [id, message, diagnosis.stage, diagnosis.code, diagnosis.cause, diagnosis.recommendation]
    ).catch(() => undefined);
    return;
  }
  const controller = new AbortController();
  activeJobs.set(id, controller);
  const startedAt = performance.now();
  let offset = Number(row.current_offset ?? 0);
  let copied = Number(row.records_copied ?? 0);
  let failed = Number(row.failed_records ?? 0);
  let retryCount = Number(row.retry_count ?? 0);
  const errors = Array.isArray(row.error_details) ? row.error_details as Array<Record<string, unknown>> : [];
  try {
    stage = "validación del esquema";
    const destinationColumns = mappedColumns(prepared.schema.columns, options.columnMappings);
    if (!prepared.exists) {
      if (!options.createDestination) throw new Error(`La tabla ${mapping.destinationTable} no existe`);
      await prepared.destinationAdapter.createTable(mapping.destinationTable, destinationColumns);
    }
    if (offset === 0 && ["replace", "truncate"].includes(options.writeMode) && prepared.exists) {
      await prepared.destinationAdapter.clearTable(mapping.destinationTable);
    }
    const keyColumns = destinationColumns.filter((column) => column.primaryKey).map((column) => column.name);
    if (options.writeMode === "upsert" && !keyColumns.length) throw new Error("UPsert requiere una clave primaria");
    await pool.query(
      "UPDATE replications SET status='running',total_records=$2,last_error=NULL,failure_stage=NULL,failure_code=NULL,failure_cause=NULL,recommendation=NULL,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1",
      [id, prepared.totalRecords]
    );
    let batch = Number(row.current_batch ?? 0);
    while (!controller.signal.aborted) {
      stage = "lectura del origen";
      const sourceRows = await prepared.sourceAdapter.readBatch(mapping.sourceTable, offset, options.batchSize);
      if (!sourceRows.length) break;
      stage = "transformación de datos";
      const rows = mapRows(sourceRows, options.columnMappings, prepared.destinationAdapter);
      let attempt = 0;
      while (true) {
        try {
          stage = "escritura del destino";
          const written = options.writeMode === "upsert"
            ? await prepared.destinationAdapter.upsertBatch(mapping.destinationTable, rows, keyColumns)
            : await prepared.destinationAdapter.insertBatch(mapping.destinationTable, rows);
          copied += written;
          break;
        } catch (error) {
          attempt++;
          retryCount++;
          if (attempt > options.maxRetries) {
            failed += rows.length;
            const diagnosis = diagnoseFailure(error, stage, mapping.destinationTable);
            errors.push({ offset, count: rows.length, message: error instanceof Error ? error.message : "Lote rechazado", ...diagnosis });
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 500 * 2 ** (attempt - 1))));
        }
      }
      offset += sourceRows.length;
      batch++;
      const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
      await pool.query(
        `UPDATE replications SET records_copied=$2,failed_records=$3,current_offset=$4,current_batch=$5,
         speed_rows_per_second=$6,retry_count=$7,error_details=$8,lag_seconds=$9,updated_at=now() WHERE id=$1`,
        [id, copied, failed, offset, batch, copied / elapsedSeconds, retryCount, JSON.stringify(errors.slice(-100)), Math.max(0, Math.round((prepared.totalRecords - offset) / Math.max(1, copied / elapsedSeconds)))]
      );
      if (sourceRows.length < options.batchSize) break;
    }
    const status = controller.signal.aborted ? "stopped" : "completed";
    const nextRun = options.scheduleMinutes ? new Date(Date.now() + options.scheduleMinutes * 60_000) : null;
    stage = "registro del resultado";
    await pool.query(
      `UPDATE replications SET status=$2::text,records_copied=$3,failed_records=$4,stopped_at=now(),
       completed_at=CASE WHEN $2::text='completed' THEN now() ELSE completed_at END,
       next_run_at=$5::timestamptz,current_offset=CASE WHEN $5::timestamptz IS NULL OR $6::boolean THEN current_offset ELSE 0 END,
       failure_stage=NULL,failure_code=NULL,
       failure_cause=CASE WHEN $7::boolean THEN 'La tabla de origen no contiene registros.' ELSE NULL END,
       recommendation=CASE WHEN $7::boolean THEN 'Importa también el archivo que contiene los INSERT o selecciona una tabla con datos.' ELSE NULL END,
       updated_at=now() WHERE id=$1`,
      [id, status, copied, failed, nextRun, options.incremental, prepared.totalRecords === 0]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replication failed";
    const diagnosis = diagnoseFailure(error, stage, mapping.sourceTable);
    await pool.query(
      "UPDATE replications SET status='failed',last_error=$2,failure_stage=$3,failure_code=$4,failure_cause=$5,recommendation=$6,stopped_at=now(),updated_at=now() WHERE id=$1",
      [id, message, diagnosis.stage, diagnosis.code, diagnosis.cause, diagnosis.recommendation]
    ).catch(() => undefined);
    logger.error({ error, replicationId: id }, "Replication failed");
  } finally {
    activeJobs.delete(id);
    await Promise.allSettled([prepared.sourceAdapter.close(), prepared.destinationAdapter.close()]);
  }
}

export async function stopReplication(id: string, userId: string): Promise<boolean> {
  const result = await pool.query("SELECT id FROM replications WHERE id=$1 AND user_id=$2 AND status IN ('starting','running','scheduled')", [id, userId]);
  if (!result.rowCount) return false;
  activeJobs.get(id)?.abort();
  await pool.query("UPDATE replications SET status='stopped',next_run_at=NULL,stopped_at=now(),updated_at=now() WHERE id=$1", [id]);
  return true;
}

export async function resumeReplication(id: string, userId: string): Promise<boolean> {
  const result = await pool.query("UPDATE replications SET status='starting',last_error=NULL,failure_stage=NULL,failure_code=NULL,failure_cause=NULL,recommendation=NULL,updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('stopped','failed') RETURNING id", [id, userId]);
  if (!result.rowCount) return false;
  void executeStoredJob(id);
  return true;
}

export async function retryReplication(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    "UPDATE replications SET status='starting',last_error=NULL,failure_stage=NULL,failure_code=NULL,failure_cause=NULL,recommendation=NULL,current_offset=0,current_batch=0,records_copied=0,failed_records=0,retry_count=0,error_details='[]'::jsonb,updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('completed','stopped','failed') RETURNING id",
    [id, userId]
  );
  if (!result.rowCount) return false;
  void executeStoredJob(id);
  return true;
}

export async function listReplications(userId: string) {
  return (await pool.query(
    `SELECT *, CASE
       WHEN status='completed' THEN 100
       WHEN total_records > 0 THEN LEAST(100,ROUND((current_offset::numeric/total_records::numeric)*100,1))
       ELSE 0
     END progress_percent
     FROM replications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [userId]
  )).rows;
}

export async function replicationReport(id: string, userId: string) {
  const row = (await pool.query("SELECT * FROM replications WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
  if (!row) throw new Error("Replicación no encontrada");
  return row;
}

export async function resumePendingReplications(): Promise<void> {
  const pending = await pool.query("SELECT id FROM replications WHERE status IN ('starting','running')");
  for (const row of pending.rows) void executeStoredJob(row.id);
  if (!schedulerStarted) {
    schedulerStarted = true;
    setInterval(async () => {
      const due = await pool.query("SELECT id FROM replications WHERE status IN ('scheduled','completed') AND next_run_at <= now()");
      for (const row of due.rows) {
        await pool.query(
          `UPDATE replications SET status='starting',
           current_offset=CASE WHEN COALESCE((options->>'incremental')::boolean,false) THEN current_offset ELSE 0 END,
           current_batch=0,records_copied=0,failed_records=0,error_details='[]'::jsonb,updated_at=now() WHERE id=$1`,
          [row.id]
        );
        void executeStoredJob(row.id);
      }
    }, 30_000).unref();
  }
}
