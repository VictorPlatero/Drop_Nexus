import { pool } from "../db/database.js";
import { getConfiguration, listConfigurations } from "./dbConfigService.js";
import { withAdapter } from "./connectionManager.js";
import { readCatalog, type FileCatalog } from "./fileCatalog.js";

export async function getHealth(userId: string) {
  await pool.query("DELETE FROM health_checks WHERE checked_at < now()-interval '7 days'").catch(() => undefined);
  const configs = await listConfigurations(userId, true);
  const replications = await pool.query(`SELECT source_config_id, destination_config_id, records_copied, lag_seconds, status FROM replications WHERE user_id=$1 AND status IN ('starting','running')`, [userId]);
  const checkedAt = new Date().toISOString();
  const items = await Promise.all(configs.map(async (config) => {
    const result = await withAdapter(config, (adapter) => adapter.testConnection()).catch((error) => ({
      ok: false, latencyMs: 5000, error: error instanceof Error ? error.message : "Error"
    }));
    const active = replications.rows.find((row) => row.source_config_id === config.id || row.destination_config_id === config.id);
    await pool.query(
      "INSERT INTO health_checks (user_id,config_id,status,latency_ms,error) VALUES ($1,$2,$3,$4,$5)",
      [userId, config.id, result.ok ? "connected" : "disconnected", result.latencyMs, result.error ?? null]
    ).catch(() => undefined);
    const history = await pool.query(
      `SELECT ROUND(AVG(latency_ms)) average_latency_ms,
       ROUND(100.0*COUNT(*) FILTER (WHERE status='connected')/GREATEST(COUNT(*),1),1) uptime_percent
       FROM health_checks WHERE config_id=$1 AND checked_at > now()-interval '24 hours'`,
      [config.id]
    );
    return {
      configId: config.id, name: config.name, engine: config.engine,
      status: result.ok ? "connected" : "disconnected", latencyMs: result.latencyMs,
      lastCheck: checkedAt, error: result.error,
      replication: active ? { recordsCopied: Number(active.records_copied), lagSeconds: active.lag_seconds, status: active.status } : null,
      history: {
        averageLatencyMs: Number(history.rows[0]?.average_latency_ms ?? result.latencyMs),
        uptimePercent: Number(history.rows[0]?.uptime_percent ?? (result.ok ? 100 : 0))
      }
    };
  }));
  const connected = items.filter((item) => item.status === "connected").length;
  const overall = connected === items.length ? "ESTABLE" : connected === 0 ? "DESCONECTADO" : "DEGRADADO";
  return { overall, checkedAt, items };
}

export interface DiagnosticIssue {
  severity: "critical" | "warning" | "info";
  code: string;
  table?: string;
  message: string;
  recommendation: string;
}

function valueMatchesType(value: unknown, dataType: string): boolean {
  if (value === null || value === undefined) return true;
  const type = dataType.toLowerCase();
  if (/bool|bit/.test(type)) return typeof value === "boolean" || value === 0 || value === 1;
  if (/number|numeric|decimal|float|double|real|int/.test(type)) return typeof value === "number" && Number.isFinite(value);
  if (/json|object|array|document/.test(type)) return typeof value === "object";
  return true;
}

function validateCatalog(catalog: FileCatalog): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  if (catalog.version !== 1 || !Array.isArray(catalog.tables)) {
    return [{
      severity: "critical",
      code: "INVALID_CATALOG",
      message: "La estructura interna del archivo no es válida.",
      recommendation: "Vuelve a importar el archivo original para reconstruir el catálogo."
    }];
  }

  const tableNames = new Set<string>();
  for (const table of catalog.tables) {
    if (tableNames.has(table.name)) {
      issues.push({
        severity: "critical",
        code: "DUPLICATE_TABLE",
        table: table.name,
        message: `La tabla o colección ${table.name} está duplicada.`,
        recommendation: "Renombra o consolida las estructuras duplicadas antes de replicar."
      });
    }
    tableNames.add(table.name);

    if (!table.columns.length) {
      issues.push({
        severity: "critical",
        code: "NO_COLUMNS",
        table: table.name,
        message: "No se detectaron columnas o campos.",
        recommendation: "Reimporta un archivo que incluya CREATE TABLE o documentos con campos."
      });
      continue;
    }
    if (!table.rows.length) {
      issues.push({
        severity: "info",
        code: "EMPTY_TABLE",
        table: table.name,
        message: "La tabla no contiene registros.",
        recommendation: "No requiere reparación; verifica si esperabas datos en esta tabla."
      });
    }

    const columnNames = table.columns.map((column) => column.name);
    const columnSet = new Set(columnNames);
    if (columnSet.size !== columnNames.length) {
      issues.push({
        severity: "critical",
        code: "DUPLICATE_COLUMN",
        table: table.name,
        message: "Existen columnas o campos con nombres duplicados.",
        recommendation: "Corrige el esquema de origen y vuelve a importarlo."
      });
    }

    const primaryKeys = table.columns.filter((column) => column.primaryKey);
    if (!primaryKeys.length && table.rows.length) {
      issues.push({
        severity: "warning",
        code: "NO_PRIMARY_KEY",
        table: table.name,
        message: "No se detectó una clave primaria.",
        recommendation: "Define una clave única para evitar duplicados durante futuras sincronizaciones."
      });
    }

    const pkValues = new Set<string>();
    table.rows.forEach((row, index) => {
      const unknown = Object.keys(row).filter((key) => !columnSet.has(key));
      if (unknown.length) {
        issues.push({
          severity: "warning",
          code: "UNKNOWN_FIELDS",
          table: table.name,
          message: `El registro ${index + 1} contiene campos fuera del esquema: ${unknown.join(", ")}.`,
          recommendation: "Actualiza el esquema o elimina los campos inesperados antes de replicar."
        });
      }
      const missingRequired = table.columns.filter((column) => !column.nullable && (row[column.name] === null || row[column.name] === undefined));
      if (missingRequired.length) {
        issues.push({
          severity: "critical",
          code: "NULL_REQUIRED",
          table: table.name,
          message: `El registro ${index + 1} no tiene valores obligatorios: ${missingRequired.map((column) => column.name).join(", ")}.`,
          recommendation: "Completa esos valores o permite NULL en el esquema."
        });
      }
      const mismatched = table.columns.filter((column) => !valueMatchesType(row[column.name], column.dataType));
      if (mismatched.length) {
        issues.push({
          severity: "warning",
          code: "TYPE_MISMATCH",
          table: table.name,
          message: `El registro ${index + 1} contiene tipos incompatibles en: ${mismatched.map((column) => column.name).join(", ")}.`,
          recommendation: "Convierte los valores al tipo declarado antes de replicar."
        });
      }
      if (primaryKeys.length) {
        const key = JSON.stringify(primaryKeys.map((column) => row[column.name]));
        if (pkValues.has(key)) {
          issues.push({
            severity: "critical",
            code: "DUPLICATE_PRIMARY_KEY",
            table: table.name,
            message: `Se detectó una clave primaria duplicada en el registro ${index + 1}.`,
            recommendation: "Corrige o elimina el registro duplicado antes de iniciar una replicación."
          });
        }
        pkValues.add(key);
      }
    });
  }
  return issues.slice(0, 200);
}

export async function diagnoseConfiguration(configId: string, userId: string) {
  const config = await getConfiguration(configId, userId);
  if (!config) throw new Error("Base de datos no encontrada");
  const startedAt = performance.now();
  try {
    if (config.options?.storageMode !== "fileCatalog" || !config.database) {
      throw new Error("El diagnóstico profundo solo está disponible para archivos importados");
    }
    const catalog = await readCatalog(config.database);
    const readStarted = performance.now();
    const sampledRows = catalog.tables.reduce((total, table) => total + Math.min(1000, table.rows.length), 0);
    const readDuration = Math.max(1, performance.now() - readStarted);
    const readRowsPerSecond = Math.round(sampledRows / (readDuration / 1000));
    const issues = validateCatalog(catalog);
    const critical = issues.filter((issue) => issue.severity === "critical").length;
    const warnings = issues.filter((issue) => issue.severity === "warning").length;
    const totalRows = catalog.tables.reduce((total, table) => total + table.rows.length, 0);
    return {
      configId,
      status: critical ? "CORRUPTA" : warnings ? "REQUIERE_AJUSTES" : "SALUDABLE",
      checkedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
      summary: { tables: catalog.tables.length, rows: totalRows, critical, warnings, informational: issues.length - critical - warnings, readRowsPerSecond },
      issues
    };
  } catch (error) {
    return {
      configId,
      status: "CORRUPTA",
      checkedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
      summary: { tables: 0, rows: 0, critical: 1, warnings: 0, informational: 0 },
      issues: [{
        severity: "critical",
        code: "UNREADABLE_FILE",
        message: error instanceof Error ? error.message : "El archivo no se puede leer.",
        recommendation: "Vuelve a importar el archivo original o recupera una copia de respaldo."
      }]
    };
  }
}

export async function getHealthHistory(configId: string, userId: string) {
  if (!await getConfiguration(configId, userId)) throw new Error("Base de datos no encontrada");
  return (await pool.query(
    `SELECT status,latency_ms,read_rows_per_second,error,checked_at
     FROM health_checks WHERE config_id=$1 AND checked_at > now()-interval '24 hours'
     ORDER BY checked_at ASC LIMIT 500`,
    [configId]
  )).rows;
}
