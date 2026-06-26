import type { DashboardSection } from "../components/Sidebar";
import type { DbConfiguration } from "../services/api";
import skillMarkdown from "../skills/database-nexus-assistant.md?raw";

export interface AssistantContext {
  section: DashboardSection;
  configurations: DbConfiguration[];
}

export interface AssistantSuggestion {
  id: string;
  label: string;
  prompt: string;
  section?: DashboardSection;
}

export interface AssistantReply {
  text: string;
  suggestions: AssistantSuggestion[];
}

interface AssistantIntent {
  keys: string[];
  answer(context: AssistantContext): AssistantReply;
}

const sectionNames: Record<DashboardSection, string> = {
  replication: "Replicador",
  configurations: "Bases de datos",
  health: "Health Monitor",
  schema: "Documentador"
};

const suggestionsBySection: Record<DashboardSection, AssistantSuggestion[]> = {
  replication: [
    { id: "replication-flow", label: "Planear replica", prompt: "Como preparo un flujo de replicacion?", section: "replication" },
    { id: "write-mode", label: "Modo escritura", prompt: "Que modo de escritura debo usar?", section: "replication" }
  ],
  configurations: [
    { id: "import-db", label: "Importar base", prompt: "Como importo una base SQLite o SQL Server?", section: "configurations" },
    { id: "verify-db", label: "Verificar archivo", prompt: "Como confirmo que una base importada se puede leer?", section: "configurations" }
  ],
  health: [
    { id: "health-check", label: "Revisar salud", prompt: "Como reviso si una base esta saludable?", section: "health" },
    { id: "latency", label: "Latencia alta", prompt: "Que hago si la latencia o disponibilidad empeora?", section: "health" }
  ],
  schema: [
    { id: "document-schema", label: "Documentar", prompt: "Como documento y exporto un esquema?", section: "schema" },
    { id: "compare-schema", label: "Comparar", prompt: "Como comparo dos esquemas?", section: "schema" }
  ]
};

const globalSuggestions: AssistantSuggestion[] = [
  { id: "replication-error", label: "Fallo replica", prompt: "Que hago si una replicacion falla?", section: "replication" },
  { id: "security", label: "Seguridad", prompt: "Como maneja Database Nexus credenciales y expiracion?" }
];

const intents: AssistantIntent[] = [
  {
    keys: ["replica", "replicacion", "replicar", "flujo", "mapeo", "mapear", "transformacion", "upsert", "insertar", "truncate", "reemplazar", "lote", "programar", "incremental"],
    answer: (context) => ({
      text: [
        "Para preparar una replicacion, abre el Replicador y completa el flujo en orden: origen y destino, tablas, mapeo, validacion y ejecucion.",
        "Usa upsert si el destino ya tiene datos con claves estables. Usa insertar para cargas nuevas. Usa vaciar y recargar cuando necesites una copia completa desde cero.",
        statusLine(context)
      ].join("\n\n"),
      suggestions: mergeSuggestions("replication", ["write-mode", "replication-error"])
    })
  },
  {
    keys: ["base", "bases", "conexion", "conexiones", "importar", "archivo", "sqlite", "sql server", "bak", "mysql", "postgres", "mongodb", "verificar"],
    answer: (context) => ({
      text: [
        "En Bases de datos puedes importar el archivo, guardar la configuracion y usar Verificar archivo para confirmar que el backend puede leerlo.",
        "Para replicar necesitas al menos dos configuraciones: una como origen y otra como destino. Recuerda que las bases importadas caducan despues de 24 horas.",
        statusLine(context)
      ].join("\n\n"),
      suggestions: mergeSuggestions("configurations", ["replication-flow", "document-schema"])
    })
  },
  {
    keys: ["health", "salud", "diagnostico", "diagnosticar", "latencia", "disponibilidad", "integridad", "corrupta", "inconsistencia"],
    answer: () => ({
      text: "Abre Health Monitor para ver disponibilidad, latencia y estado general. Si algo aparece degradado, ejecuta Diagnostico profundo; la app devuelve causa probable y recomendacion por base.",
      suggestions: mergeSuggestions("health", ["replication-error", "document-schema"])
    })
  },
  {
    keys: ["documentar", "documentador", "esquema", "tabla", "coleccion", "exportar", "excel", "csv", "json", "markdown", "html", "comparar", "perfil"],
    answer: () => ({
      text: "En Documentador selecciona una base, explora el esquema y revisa datos de muestra. Desde ahi puedes comparar contra otra base y exportar documentacion en HTML o Markdown, ademas de datos en Excel, CSV o JSON.",
      suggestions: mergeSuggestions("schema", ["compare-schema", "health-check"])
    })
  },
  {
    keys: ["error", "fallo", "falla", "failed", "rechazado", "rechazados", "timeout", "detuvo", "lento", "reintento", "reintentar", "duplicado", "incompatible"],
    answer: () => ({
      text: [
        "Si una replicacion falla, abre el detalle del error en Actividad e historial. Revisa etapa, causa probable y recomendacion.",
        "Despues prueba: validar otra vez el flujo, ajustar mapeos/tipos, bajar el tamano de lote si hay timeouts, o usar Continuar/Reiniciar segun el estado. El reporte JSON ayuda cuando necesitas evidencia tecnica."
      ].join("\n\n"),
      suggestions: mergeSuggestions("replication", ["health-check", "document-schema"])
    })
  },
  {
    keys: ["seguridad", "credencial", "credenciales", "password", "contrasena", "secreto", "cifrado", "jwt", "expira", "expiracion", "24 horas", "tenant", "usuario"],
    answer: () => ({
      text: "Database Nexus cifra credenciales externas, no las devuelve al cliente, aisla configuraciones por usuario y limpia bases importadas despues de 24 horas. Evita pegar secretos en el chat o en reportes compartidos.",
      suggestions: mergeSuggestions("configurations", ["health-check", "document-schema"])
    })
  },
  {
    keys: ["skill", "plugin", "asistente", "chat", "contexto", "consultas"],
    answer: () => ({
      text: "Este chat usa una skill Markdown incluida en el frontend y un plugin local adaptado a Database Nexus. La skill define contexto, reglas y consultas sugeridas; el plugin convierte tus preguntas en respuestas y atajos dentro del dashboard.",
      suggestions: mergeSuggestions("replication", ["import-db", "document-schema"])
    })
  }
];

export const databaseNexusAssistantPlugin = {
  id: "database-nexus-assistant",
  name: "Nexus Assistant",
  skillMarkdown,
  getWelcomeMessage(context: AssistantContext): string {
    return [
      `Hola, soy Nexus Assistant. Estoy conectado a la seccion ${sectionNames[context.section]}.`,
      "Puedo ayudarte con importaciones, replicaciones, health checks, documentacion de esquemas y fallos comunes."
    ].join(" ");
  },
  getSuggestions(context: AssistantContext): AssistantSuggestion[] {
    return dedupe([...suggestionsBySection[context.section], ...globalSuggestions]).slice(0, 4);
  },
  ask(input: string, context: AssistantContext): AssistantReply {
    const normalized = normalize(input);
    const intent = intents.find((item) => item.keys.some((key) => normalized.includes(key)));
    if (intent) return intent.answer(context);

    return {
      text: [
        `Estoy en modo guia para ${sectionNames[context.section]}.`,
        fallbackBySection(context.section),
        "Prueba con una pregunta sobre replicacion, importacion, health monitor, documentacion o seguridad."
      ].join("\n\n"),
      suggestions: this.getSuggestions(context)
    };
  }
};

function mergeSuggestions(section: DashboardSection, extraIds: string[]): AssistantSuggestion[] {
  const indexed = new Map<string, AssistantSuggestion>();
  [...suggestionsBySection[section], ...Object.values(suggestionsBySection).flat(), ...globalSuggestions].forEach((suggestion) => indexed.set(suggestion.id, suggestion));
  return dedupe([...suggestionsBySection[section], ...extraIds.map((id) => indexed.get(id)).filter((item): item is AssistantSuggestion => Boolean(item)), ...globalSuggestions]).slice(0, 4);
}

function dedupe(suggestions: AssistantSuggestion[]): AssistantSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    if (seen.has(suggestion.id)) return false;
    seen.add(suggestion.id);
    return true;
  });
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function statusLine(context: AssistantContext): string {
  const count = context.configurations.length;
  if (count === 0) return "Ahora no hay bases importadas; empieza en Bases de datos antes de crear el flujo.";
  if (count === 1) return "Ahora tienes 1 base importada; agrega una segunda configuracion para usarla como destino u origen.";
  return `Ahora tienes ${count} bases importadas, suficiente para crear un flujo origen-destino.`;
}

function fallbackBySection(section: DashboardSection): string {
  if (section === "replication") return "Aqui conviene preguntar por tablas, mapeos, modos de escritura, lotes, programacion o errores de ejecucion.";
  if (section === "configurations") return "Aqui puedo ayudarte a importar, verificar, editar o eliminar configuraciones de bases.";
  if (section === "health") return "Aqui puedo orientarte sobre disponibilidad, latencia, diagnostico profundo e integridad.";
  return "Aqui puedo ayudarte a explorar tablas, comparar esquemas y exportar documentacion o datos.";
}
