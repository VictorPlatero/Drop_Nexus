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
