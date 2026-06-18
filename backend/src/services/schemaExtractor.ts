import { getConfiguration } from "./dbConfigService.js";
import { withAdapter } from "./connectionManager.js";

const EXPORT_BATCH_SIZE = 5000;
const MAX_EXPORT_ROWS_PER_TABLE = 100_000;

export async function extractSchema(configId: string, userId: string) {
  const config = await getConfiguration(configId, userId);
  if (!config) throw new Error("Configuración no encontrada");
  return withAdapter(config, async (adapter) => {
    const tables = await adapter.listTables();
    return Promise.all(tables.map((table) => adapter.getTableSchema(table)));
  });
}

export async function extractTableData(
  configId: string,
  userId: string,
  table: string,
  offset: number,
  limit: number
) {
  const config = await getConfiguration(configId, userId);
  if (!config) throw new Error("Configuración no encontrada");
  return withAdapter(config, async (adapter) => {
    if (!(await adapter.listTables()).includes(table)) throw new Error("Tabla o colección no encontrada");
    const rows = await adapter.readBatch(table, offset, limit + 1);
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit, offset, limit };
  });
}

export async function compareSchemas(sourceConfigId: string, destinationConfigId: string, userId: string) {
  const [source, destination] = await Promise.all([
    extractSchema(sourceConfigId, userId),
    extractSchema(destinationConfigId, userId)
  ]);
  const destinationMap = new Map(destination.map((table) => [table.name, table]));
  return source.map((sourceTable) => {
    const destinationTable = destinationMap.get(sourceTable.name);
    if (!destinationTable) return { table: sourceTable.name, status: "missing", missingColumns: sourceTable.columns.map((column) => column.name), extraColumns: [], typeDifferences: [] };
    const sourceColumns = new Map(sourceTable.columns.map((column) => [column.name, column]));
    const destinationColumns = new Map(destinationTable.columns.map((column) => [column.name, column]));
    return {
      table: sourceTable.name,
      status: "present",
      missingColumns: sourceTable.columns.filter((column) => !destinationColumns.has(column.name)).map((column) => column.name),
      extraColumns: destinationTable.columns.filter((column) => !sourceColumns.has(column.name)).map((column) => column.name),
      typeDifferences: sourceTable.columns.flatMap((column) => {
        const target = destinationColumns.get(column.name);
        return target && target.dataType.toLowerCase() !== column.dataType.toLowerCase()
          ? [{ column: column.name, sourceType: column.dataType, destinationType: target.dataType }]
          : [];
      })
    };
  });
}

export async function tableStatistics(configId: string, userId: string, table: string) {
  const config = await getConfiguration(configId, userId);
  if (!config) throw new Error("Configuración no encontrada");
  return withAdapter(config, async (adapter) => {
    const schema = await adapter.getTableSchema(table);
    const totalRows = await adapter.countRows(table);
    const sample = await adapter.readBatch(table, 0, Math.min(5000, totalRows));
    return {
      table,
      totalRows,
      sampleRows: sample.length,
      columns: schema.columns.map((column) => {
        const values = sample.map((row) => row[column.name]);
        const nonNull = values.filter((value) => value !== null && value !== undefined);
        const comparable = nonNull.filter((value): value is number | string => typeof value === "number" || typeof value === "string");
        const unique = new Set(nonNull.map((value) => typeof value === "object" ? JSON.stringify(value) : String(value))).size;
        return {
          name: column.name,
          dataType: column.dataType,
          nulls: values.length - nonNull.length,
          unique,
          min: comparable.length ? comparable.reduce((minimum, value) => value < minimum ? value : minimum) : null,
          max: comparable.length ? comparable.reduce((maximum, value) => value > maximum ? value : maximum) : null
        };
      })
    };
  });
}

export async function extractDatabaseData(configId: string, userId: string) {
  const config = await getConfiguration(configId, userId);
  if (!config) throw new Error("Configuración no encontrada");
  const tables = await withAdapter(config, async (adapter) => Promise.all(
    (await adapter.listTables()).map(async (name) => {
      const rows: Record<string, unknown>[] = [];
      while (rows.length < MAX_EXPORT_ROWS_PER_TABLE) {
        const batchSize = Math.min(EXPORT_BATCH_SIZE, MAX_EXPORT_ROWS_PER_TABLE - rows.length);
        const batch = await adapter.readBatch(name, rows.length, batchSize);
        rows.push(...batch);
        if (batch.length < batchSize) break;
      }
      return {
        name,
        columns: (await adapter.getTableSchema(name)).columns,
        rows,
        truncated: rows.length >= MAX_EXPORT_ROWS_PER_TABLE
      };
    })
  ));
  return { database: config.name, engine: config.engine, generatedAt: new Date().toISOString(), tables };
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function tableToCsv(table: Awaited<ReturnType<typeof extractDatabaseData>>["tables"][number]): string {
  const columns = table.columns.length
    ? table.columns.map((column) => column.name)
    : [...new Set(table.rows.flatMap((row) => Object.keys(row)))];
  return [
    columns.map(escapeCsv).join(","),
    ...table.rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","))
  ].join("\r\n");
}

function escapeXml(value: unknown): string {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function excelCell(value: unknown, header = false): string {
  const type = typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
  return `<Cell${header ? ' ss:StyleID="Header"' : ""}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

export function databaseToExcelXml(data: Awaited<ReturnType<typeof extractDatabaseData>>): string {
  const worksheets = data.tables.map((table, index) => {
    const columns = table.columns.length
      ? table.columns.map((column) => column.name)
      : [...new Set(table.rows.flatMap((row) => Object.keys(row)))];
    const sheetName = table.name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Tabla ${index + 1}`;
    const rows = [
      `<Row>${columns.map((column) => excelCell(column, true)).join("")}</Row>`,
      ...table.rows.map((row) => `<Row>${columns.map((column) => excelCell(row[column])).join("")}</Row>`)
    ].join("");
    return `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>${rows}</Table></Worksheet>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style></Styles>
 ${worksheets}
</Workbook>`;
}

export function schemaToMarkdown(databaseName: string, tables: Awaited<ReturnType<typeof extractSchema>>): string {
  const sections = tables.map((table) => {
    const rows = table.columns.map((column) =>
      `| ${column.name} | ${column.dataType} | ${column.nullable ? "Sí" : "No"} | ${column.primaryKey ? "🔑" : ""} | ${column.foreignKey ? "🔗" : ""} |`
    ).join("\n");
    return `## ${table.name}\n\n| Columna | Tipo | Nullable | PK | FK |\n|---|---|---|---|---|\n${rows}`;
  });
  return `# Documentación de esquema: ${databaseName}\n\nGenerado: ${new Date().toISOString()}\n\n${sections.join("\n\n")}\n`;
}

export function schemaToHtml(databaseName: string, tables: Awaited<ReturnType<typeof extractSchema>>): string {
  const body = tables.map((table) => `<section><h2>${escapeXml(table.name)}</h2><table><thead><tr><th>Columna</th><th>Tipo</th><th>Nullable</th><th>Claves</th></tr></thead><tbody>${table.columns.map((column) =>
    `<tr><td>${escapeXml(column.name)}</td><td>${escapeXml(column.dataType)}</td><td>${column.nullable ? "Sí" : "No"}</td><td>${column.primaryKey ? "PK " : ""}${column.foreignKey ? "FK" : ""}</td></tr>`
  ).join("")}</tbody></table></section>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeXml(databaseName)}</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#222}table{border-collapse:collapse;width:100%;margin-bottom:28px}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#eef3f8}@media print{body{margin:12mm}}</style></head><body><h1>${escapeXml(databaseName)}</h1><p>Generado: ${new Date().toLocaleString("es")}</p>${body}</body></html>`;
}
