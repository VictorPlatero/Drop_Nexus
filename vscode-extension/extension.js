const vscode = require("vscode");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PROJECT_FILES = {
  skill: "frontend/src/skills/database-nexus-assistant.md",
  plugin: "frontend/src/plugins/databaseNexusAssistantPlugin.ts",
  chatbox: "frontend/src/components/NexusChatbox.tsx",
  dashboard: "frontend/src/pages/Dashboard.tsx",
  assistantRoute: "backend/src/routes/assistant.ts"
};

const PROMPTS = [
  {
    label: "Planear flujo de replicacion",
    detail: "Origen, destino, tablas, mapeo, validacion y ejecucion",
    text: "Como preparo un flujo de replicacion entre dos bases de datos?"
  },
  {
    label: "Elegir modo de escritura",
    detail: "Insertar, upsert, reemplazar o vaciar y recargar",
    text: "Que modo de escritura debo usar para esta replicacion y por que?"
  },
  {
    label: "Resolver fallo de replica",
    detail: "Errores de tipos, timeouts, duplicados o tablas faltantes",
    text: "Que hago si una replicacion falla durante el mapeo o la ejecucion?"
  },
  {
    label: "Importar base",
    detail: "SQLite, SQL Server, PostgreSQL, MySQL, MariaDB, Oracle o MongoDB",
    text: "Como importo una base y la preparo como origen o destino?"
  }
];

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("databaseNexus.openSkill", () => openProjectFile(PROJECT_FILES.skill)),
    vscode.commands.registerCommand("databaseNexus.openPlugin", () => openProjectFile(PROJECT_FILES.plugin)),
    vscode.commands.registerCommand("databaseNexus.openChatbox", () => openProjectFile(PROJECT_FILES.chatbox)),
    vscode.commands.registerCommand("databaseNexus.insertPrompt", insertSuggestedPrompt),
    vscode.commands.registerCommand("databaseNexus.validateAssistant", validateAssistantIntegration),
    vscode.commands.registerCommand("databaseNexus.describeDatabaseFile", describeDatabaseFile),
    vscode.commands.registerCommand("databaseNexus.generateReplicationScript", generateReplicationScript),
    vscode.commands.registerCommand("databaseNexus.openLocalApp", () => vscode.env.openExternal(vscode.Uri.parse("http://localhost:5173")))
  );
}

function deactivate() {}

async function openProjectFile(relativePath) {
  const root = workspaceRoot();
  if (!root) return;

  const uri = vscode.Uri.joinPath(root, ...relativePath.split("/"));
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  } catch {
    vscode.window.showErrorMessage(`No se encontro ${relativePath}`);
  }
}

async function insertSuggestedPrompt() {
  const selected = await vscode.window.showQuickPick(PROMPTS, {
    placeHolder: "Elige una consulta para el asistente de Database Nexus"
  });
  if (!selected) return;

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    await editor.edit((edit) => edit.insert(editor.selection.active, selected.text));
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: selected.text
  });
  await vscode.window.showTextDocument(document);
}

async function validateAssistantIntegration() {
  const root = workspaceRoot();
  if (!root) return;

  const checks = [
    fileCheck("Skill .md", PROJECT_FILES.skill, "## Consultas sugeridas"),
    fileCheck("Plugin del proyecto", PROJECT_FILES.plugin, "databaseNexusAssistantPlugin"),
    fileCheck("Chatbox integrado", PROJECT_FILES.chatbox, "Skill local .md + plugin del proyecto"),
    fileCheck("Dashboard monta chatbox", PROJECT_FILES.dashboard, "<NexusChatbox"),
    fileCheck("Ruta backend del asistente", PROJECT_FILES.assistantRoute, "section: z.enum")
  ];

  const results = await Promise.all(checks.map((check) => runCheck(root, check)));
  const failed = results.filter((result) => !result.ok);
  const report = results.map((result) => `${result.ok ? "OK" : "FALTA"} - ${result.name}: ${result.message}`).join("\n");

  const document = await vscode.workspace.openTextDocument({
    language: "plaintext",
    content: `Database Nexus Assistant Check\n\n${report}\n`
  });
  await vscode.window.showTextDocument(document);

  if (failed.length) {
    vscode.window.showWarningMessage(`Database Nexus: ${failed.length} verificacion(es) requieren revision.`);
  } else {
    vscode.window.showInformationMessage("Database Nexus: skill, plugin y chatbox estan integrados.");
  }
}

async function describeDatabaseFile(uri) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target || target.scheme !== "file") {
    vscode.window.showErrorMessage("Selecciona un archivo .sql, .sqlite, .db, .json o .csv para inspeccionarlo.");
    return;
  }

  const filePath = target.fsPath;
  const extension = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath);

  try {
    const stat = await fs.stat(filePath);
    let report;
    if ([".sql"].includes(extension)) {
      report = await describeSqlFile(filePath, baseName, stat.size);
    } else if ([".sqlite", ".sqlite3", ".db"].includes(extension)) {
      report = await describeSqliteFile(filePath, baseName, stat.size);
    } else if ([".json", ".ndjson"].includes(extension)) {
      report = await describeJsonFile(filePath, baseName, stat.size, extension);
    } else if ([".csv"].includes(extension)) {
      report = await describeCsvFile(filePath, baseName, stat.size);
    } else {
      report = [
        `# Contenido de ${baseName}`,
        "",
        `- Ruta: ${filePath}`,
        `- Tamano: ${formatBytes(stat.size)}`,
        `- Extension: ${extension || "sin extension"}`,
        "",
        "No hay analizador especifico para este formato en la extension. Importalo en Database Nexus para ver tablas, columnas y filas desde la app."
      ].join("\n");
    }

    const document = await vscode.workspace.openTextDocument({ language: "markdown", content: report });
    await vscode.window.showTextDocument(document);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : "No se pudo inspeccionar el archivo.");
  }
}

async function describeSqlFile(filePath, baseName, size) {
  const content = await fs.readFile(filePath, "utf8");
  const tables = [...content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([`"[\]\w.]+)\s*\(([\s\S]*?)\)\s*;/gi)]
    .map((match) => ({
      name: cleanIdentifier(match[1]),
      columns: extractSqlColumns(match[2])
    }));
  const inserts = [...content.matchAll(/insert\s+(?:ignore\s+)?into\s+([`"[\]\w.]+)/gi)]
    .reduce((counts, match) => {
      const table = cleanIdentifier(match[1]);
      counts.set(table, (counts.get(table) ?? 0) + 1);
      return counts;
    }, new Map());

  return [
    `# Contenido de ${baseName}`,
    "",
    `- Tipo detectado: Script SQL`,
    `- Tamano: ${formatBytes(size)}`,
    `- Tablas detectadas: ${tables.length}`,
    `- Sentencias INSERT detectadas: ${[...inserts.values()].reduce((total, value) => total + value, 0)}`,
    "",
    "## Tablas",
    "",
    tables.length ? tables.map((table) => [
      `### ${table.name}`,
      "",
      `- Columnas: ${table.columns.length}`,
      `- INSERT asociados: ${inserts.get(table.name) ?? 0}`,
      "",
      table.columns.length ? table.columns.map((column) => `- ${column.name}: ${column.type}`).join("\n") : "- No se pudieron detectar columnas."
    ].join("\n")).join("\n\n") : "No se encontraron sentencias CREATE TABLE."
  ].join("\n");
}

async function describeSqliteFile(filePath, baseName, size) {
  try {
    const { stdout } = await execFileAsync("sqlite3", [
      filePath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    ], { windowsHide: true, timeout: 10000 });
    const tables = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sections = [];
    for (const table of tables) {
      const escaped = table.replaceAll('"', '""');
      const [{ stdout: columnsOut }, { stdout: countOut }] = await Promise.all([
        execFileAsync("sqlite3", [filePath, `PRAGMA table_info("${escaped}");`], { windowsHide: true, timeout: 10000 }),
        execFileAsync("sqlite3", [filePath, `SELECT COUNT(*) FROM "${escaped}";`], { windowsHide: true, timeout: 10000 })
      ]);
      const columns = columnsOut.split(/\r?\n/).filter(Boolean).map((line) => {
        const [, name, type, notNull, , pk] = line.split("|");
        return `- ${name}: ${type || "sin tipo"}${pk === "1" ? " - PK" : ""}${notNull === "1" ? " - NOT NULL" : ""}`;
      });
      sections.push([`### ${table}`, "", `- Filas: ${Number(countOut.trim() || 0).toLocaleString()}`, `- Columnas: ${columns.length}`, "", columns.join("\n") || "- Sin columnas detectadas."].join("\n"));
    }
    return [
      `# Contenido de ${baseName}`,
      "",
      `- Tipo detectado: SQLite`,
      `- Tamano: ${formatBytes(size)}`,
      `- Tablas detectadas: ${tables.length}`,
      "",
      "## Tablas",
      "",
      sections.join("\n\n") || "No se encontraron tablas."
    ].join("\n");
  } catch {
    return [
      `# Contenido de ${baseName}`,
      "",
      `- Tipo detectado: SQLite`,
      `- Tamano: ${formatBytes(size)}`,
      "",
      "No pude leer las tablas porque el comando `sqlite3` no esta disponible en este equipo.",
      "Instala SQLite CLI o importa el archivo en Database Nexus para ver tablas, columnas y filas."
    ].join("\n");
  }
}

async function describeJsonFile(filePath, baseName, size, extension) {
  const content = await fs.readFile(filePath, "utf8");
  const rows = extension === ".ndjson"
    ? content.split(/\r?\n/).filter(Boolean).slice(0, 100).map((line) => JSON.parse(line))
    : normalizeJsonRows(JSON.parse(content));
  const keys = [...new Set(rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : []))];
  return [
    `# Contenido de ${baseName}`,
    "",
    `- Tipo detectado: ${extension === ".ndjson" ? "NDJSON" : "JSON"}`,
    `- Tamano: ${formatBytes(size)}`,
    `- Registros muestreados: ${rows.length}`,
    `- Campos detectados: ${keys.length}`,
    "",
    "## Campos",
    "",
    keys.length ? keys.map((key) => `- ${key}`).join("\n") : "No se detectaron campos tabulares."
  ].join("\n");
}

async function describeCsvFile(filePath, baseName, size) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines[0] ?? "");
  return [
    `# Contenido de ${baseName}`,
    "",
    "- Tipo detectado: CSV",
    `- Tamano: ${formatBytes(size)}`,
    `- Filas aproximadas: ${Math.max(0, lines.length - 1).toLocaleString()}`,
    `- Columnas: ${headers.length}`,
    "",
    "## Columnas",
    "",
    headers.length ? headers.map((header) => `- ${header}`).join("\n") : "No se detectaron encabezados."
  ].join("\n");
}

async function generateReplicationScript() {
  const engine = await vscode.window.showQuickPick(["MySQL / MariaDB", "PostgreSQL", "SQL Server"], {
    placeHolder: "Motor para el script de replicacion"
  });
  if (!engine) return;

  const source = await askInput("Tabla origen", "panaderia.productos o public.productos");
  if (!source) return;
  const destination = await askInput("Tabla destino", "hospital.productos_copia o public.productos_copia");
  if (!destination) return;
  const columnsText = await askInput("Columnas a copiar", "id,nombre,precio,stock");
  if (!columnsText) return;
  const mode = await vscode.window.showQuickPick(["insert", "upsert", "replace"], {
    placeHolder: "Modo de escritura del script"
  });
  if (!mode) return;
  const keyColumnsText = mode === "upsert" ? await askInput("Columnas clave para upsert", "id") : "";
  if (mode === "upsert" && !keyColumnsText) return;

  const columns = columnsText.split(",").map((value) => value.trim()).filter(Boolean);
  const keyColumns = keyColumnsText.split(",").map((value) => value.trim()).filter(Boolean);
  const script = buildReplicationScript(engine, source, destination, columns, mode, keyColumns);
  const document = await vscode.workspace.openTextDocument({ language: "sql", content: script });
  await vscode.window.showTextDocument(document);
}

function fileCheck(name, relativePath, expectedText) {
  return { name, relativePath, expectedText };
}

function extractSqlColumns(definition) {
  return definition.split(/,(?![^()]*\))/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(primary|foreign|unique|constraint|key|index|check)\b/i.test(line))
    .map((line) => {
      const match = line.match(/^([`"[\]\w]+)\s+(.+)$/);
      return {
        name: cleanIdentifier(match?.[1] ?? line.split(/\s+/)[0] ?? "columna"),
        type: (match?.[2] ?? "").split(/\s+(not|null|primary|default|references|unique|check)\b/i)[0].trim() || "sin tipo"
      };
    });
}

function cleanIdentifier(value) {
  return value.replace(/^[`"[]+|[`"\]]+$/g, "");
}

function normalizeJsonRows(value) {
  if (Array.isArray(value)) return value.slice(0, 100);
  if (value && typeof value === "object") {
    const firstArray = Object.values(value).find((item) => Array.isArray(item));
    if (Array.isArray(firstArray)) return firstArray.slice(0, 100);
    return [value];
  }
  return [];
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values.filter(Boolean);
}

async function askInput(prompt, placeHolder) {
  return vscode.window.showInputBox({ prompt, placeHolder, ignoreFocusOut: true });
}

function buildReplicationScript(engine, source, destination, columns, mode, keyColumns) {
  const header = [
    "-- Script generado por Database Nexus Replicator",
    "-- Revisa nombres, permisos y tipos antes de ejecutarlo.",
    "-- Este script asume que ambas tablas son accesibles desde la misma conexion/servidor.",
    ""
  ].join("\n");
  if (engine === "MySQL / MariaDB") return `${header}${mysqlReplicationScript(source, destination, columns, mode, keyColumns)}`;
  if (engine === "PostgreSQL") return `${header}${postgresReplicationScript(source, destination, columns, mode, keyColumns)}`;
  return `${header}${sqlServerReplicationScript(source, destination, columns, mode, keyColumns)}`;
}

function mysqlReplicationScript(source, destination, columns, mode, keyColumns) {
  const columnList = columns.map(mysqlQuote).join(", ");
  const updateList = columns.filter((column) => !keyColumns.includes(column)).map((column) => `${mysqlQuote(column)} = VALUES(${mysqlQuote(column)})`).join(",\n  ");
  const prefix = mode === "replace" ? "REPLACE" : "INSERT";
  return [
    `${prefix} INTO ${mysqlQualified(destination)} (${columnList})`,
    `SELECT ${columnList}`,
    `FROM ${mysqlQualified(source)}`,
    mode === "upsert" && updateList ? `ON DUPLICATE KEY UPDATE\n  ${updateList}` : "",
    ";"
  ].filter(Boolean).join("\n");
}

function postgresReplicationScript(source, destination, columns, mode, keyColumns) {
  const columnList = columns.map(pgQuote).join(", ");
  const updateList = columns.filter((column) => !keyColumns.includes(column)).map((column) => `${pgQuote(column)} = EXCLUDED.${pgQuote(column)}`).join(",\n  ");
  const conflict = keyColumns.map(pgQuote).join(", ");
  const insert = [
    `INSERT INTO ${pgQualified(destination)} (${columnList})`,
    `SELECT ${columnList}`,
    `FROM ${pgQualified(source)}`
  ].join("\n");
  if (mode === "replace") return `TRUNCATE TABLE ${pgQualified(destination)};\n\n${insert};`;
  if (mode === "upsert") return `${insert}\nON CONFLICT (${conflict}) ${updateList ? `DO UPDATE SET\n  ${updateList}` : "DO NOTHING"};`;
  return `${insert};`;
}

function sqlServerReplicationScript(source, destination, columns, mode, keyColumns) {
  const columnList = columns.map(sqlServerQuote).join(", ");
  const sourceAliasColumns = columns.map((column) => `source.${sqlServerQuote(column)}`).join(", ");
  if (mode === "replace") {
    return `TRUNCATE TABLE ${sqlServerQualified(destination)};\n\nINSERT INTO ${sqlServerQualified(destination)} (${columnList})\nSELECT ${columnList}\nFROM ${sqlServerQualified(source)};`;
  }
  if (mode === "upsert") {
    const match = keyColumns.map((column) => `target.${sqlServerQuote(column)} = source.${sqlServerQuote(column)}`).join(" AND ");
    const updates = columns.filter((column) => !keyColumns.includes(column)).map((column) => `target.${sqlServerQuote(column)} = source.${sqlServerQuote(column)}`).join(",\n  ");
    return [
      `MERGE ${sqlServerQualified(destination)} AS target`,
      `USING (SELECT ${columnList} FROM ${sqlServerQualified(source)}) AS source`,
      `ON ${match}`,
      updates ? `WHEN MATCHED THEN UPDATE SET\n  ${updates}` : "",
      `WHEN NOT MATCHED THEN INSERT (${columnList}) VALUES (${sourceAliasColumns});`
    ].filter(Boolean).join("\n");
  }
  return `INSERT INTO ${sqlServerQualified(destination)} (${columnList})\nSELECT ${columnList}\nFROM ${sqlServerQualified(source)};`;
}

function mysqlQualified(value) { return value.split(".").map(mysqlQuote).join("."); }
function pgQualified(value) { return value.split(".").map(pgQuote).join("."); }
function sqlServerQualified(value) { return value.split(".").map(sqlServerQuote).join("."); }
function mysqlQuote(value) { return `\`${value.replaceAll("`", "``")}\``; }
function pgQuote(value) { return `"${value.replaceAll('"', '""')}"`; }
function sqlServerQuote(value) { return `[${value.replaceAll("]", "]]")}]`; }
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function runCheck(root, check) {
  const uri = vscode.Uri.joinPath(root, ...check.relativePath.split("/"));
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(bytes).toString("utf8");
    const ok = content.includes(check.expectedText);
    return {
      name: check.name,
      ok,
      message: ok ? check.relativePath : `No se encontro el texto esperado en ${check.relativePath}`
    };
  } catch {
    return {
      name: check.name,
      ok: false,
      message: `No existe ${check.relativePath}`
    };
  }
}

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage("Abre la carpeta Drop_Nexus para usar Database Nexus Replicator.");
    return undefined;
  }
  return folder.uri;
}

module.exports = { activate, deactivate };
