const vscode = require("vscode");

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

function fileCheck(name, relativePath, expectedText) {
  return { name, relativePath, expectedText };
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
