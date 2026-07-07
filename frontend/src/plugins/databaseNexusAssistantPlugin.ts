import type { DashboardSection } from "../components/Sidebar";
import { api, type DbConfiguration } from "../services/api";
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
  configurations: "Bases de datos"
};

const suggestionsBySection: Record<DashboardSection, AssistantSuggestion[]> = {
  replication: [
    { id: "replication-flow", label: "Planear replica", prompt: "Como preparo un flujo de replicacion?", section: "replication" },
    { id: "write-mode", label: "Modo escritura", prompt: "Que modo de escritura debo usar?", section: "replication" }
  ],
  configurations: [
    { id: "import-db", label: "Importar base", prompt: "Como importo una base SQLite o SQL Server?", section: "configurations" },
    { id: "remote-railway", label: "Conectar Railway", prompt: "Como conecto una base MySQL de Railway por TCP Proxy?", section: "configurations" },
    { id: "verify-db", label: "Verificar conexion", prompt: "Como confirmo que una base remota se puede leer?", section: "configurations" }
  ]
};

const globalSuggestions: AssistantSuggestion[] = [
  { id: "azure-sql", label: "Azure SQL", prompt: "Como conecto una base SQL Server o Azure SQL?", section: "configurations" },
  { id: "replication-error", label: "Fallo replica", prompt: "Que hago si una replicacion falla?", section: "replication" },
  { id: "security", label: "Seguridad", prompt: "Como maneja Database Nexus credenciales y expiracion?" }
];

const intents: AssistantIntent[] = [
  {
    keys: ["replica", "replicacion", "replicar", "flujo", "mapeo", "mapear", "transformacion", "upsert", "insertar", "truncate", "reemplazar", "lote", "programar", "incremental"],
    answer: (context) => ({
      text: [
        "Para preparar una replicacion entre bases de datos, abre el Replicador y completa el flujo en orden: origen y destino, tablas, mapeo, validacion y ejecucion.",
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
        "Para replicar necesitas al menos dos configuraciones: una como origen y otra como destino. Recuerda que las bases importadas caducan despues de 24 horas; las conexiones remotas quedan persistentes.",
        statusLine(context)
      ].join("\n\n"),
      suggestions: mergeSuggestions("configurations", ["replication-flow"])
    })
  },
  {
    keys: ["railway", "proxy", "tcp", "rlwy", "mysqlhost", "mysqlport", "mysqlpassword", "mysql_url", "hayabusa"],
    answer: () => ({
      text: [
        "Para Railway MySQL usa el bloque Public Networking > TCP Proxy, no el dominio HTTP ni mysql.railway.internal.",
        "En Bases de datos > Agregar base > Conexion remota elige MySQL. Servidor: dominio proxy, por ejemplo hayabusa.proxy.rlwy.net. Puerto: el numero publico del proxy. Usuario, contrasena y base salen de Variables: MYSQLUSER, MYSQLPASSWORD y MYSQLDATABASE.",
        "En Railway MySQL empieza con Cifrar en Desactivado; si tu URL o proveedor exige TLS, cambia a Obligatorio. Luego guarda, usa Verificar conexion y finalmente Ver contenido."
      ].join("\n\n"),
      suggestions: mergeSuggestions("configurations", ["verify-db", "replication-flow"])
    })
  },
  {
    keys: ["azure", "sql azure", "azure sql", "sqlserver nube", "sql server nube", "1433"],
    answer: () => ({
      text: [
        "Para Azure SQL o SQL Server remoto elige SQL Server en Conexion remota.",
        "Usa el servidor publico, puerto 1433, nombre de base, usuario y contrasena. Mantén Cifrar en Obligatorio y Certificado de servidor de confianza activado si el certificado no valida en el entorno.",
        "Si falla, revisa firewall de Azure, que permita conexiones desde el servicio donde corre Database Nexus, y prueba Verificar conexion antes de replicar."
      ].join("\n\n"),
      suggestions: mergeSuggestions("configurations", ["verify-db", "replication-flow"])
    })
  },
  {
    keys: ["descargar", "download", "exportar", "modificada", "resultado", "xlsx", "excel", "sqlite", "json"],
    answer: () => ({
      text: "Despues de replicar, ve a Bases de datos y usa Descargar base modificada en la tarjeta del destino. Puedes bajarla como Excel, SQLite o JSON. Si el destino es una conexion externa, exportala desde ese motor porque no existe un archivo local que descargar.",
      suggestions: mergeSuggestions("configurations", ["replication-flow"])
    })
  },
  {
    keys: ["error", "fallo", "falla", "failed", "rechazado", "rechazados", "timeout", "detuvo", "lento", "reintento", "reintentar", "duplicado", "incompatible"],
    answer: () => ({
      text: [
        "Si una replicacion falla, abre el detalle del error en Actividad e historial. Revisa etapa, causa probable y recomendacion.",
        "Despues prueba: validar otra vez el flujo, ajustar mapeos/tipos, bajar el tamano de lote si hay timeouts, o usar Continuar/Reiniciar segun el estado. El reporte JSON ayuda cuando necesitas evidencia tecnica."
      ].join("\n\n"),
      suggestions: mergeSuggestions("replication", ["write-mode", "import-db"])
    })
  },
  {
    keys: ["seguridad", "credencial", "credenciales", "password", "contrasena", "secreto", "cifrado", "jwt", "expira", "expiracion", "24 horas", "tenant", "usuario"],
    answer: () => ({
      text: "Database Nexus cifra credenciales externas, no las devuelve al cliente, aisla configuraciones por usuario y limpia bases importadas despues de 24 horas. Las conexiones remotas permanecen hasta que el usuario las elimine. Evita pegar secretos en el chat o en reportes compartidos.",
      suggestions: mergeSuggestions("configurations", ["replication-flow"])
    })
  },
  {
    keys: ["skill", "plugin", "asistente", "chat", "contexto", "consultas", "extension", "visual code", "vscode"],
    answer: () => ({
      text: "Este chat usa una skill Markdown incluida en el frontend y un plugin local adaptado al replicador de datos entre bases de datos. La skill define contexto, reglas y consultas sugeridas; el plugin convierte tus preguntas en respuestas y atajos dentro del dashboard.",
      suggestions: mergeSuggestions("replication", ["import-db", "write-mode"])
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
      "Puedo ayudarte a importar bases, conectar Railway/Azure/Supabase, preparar flujos origen-destino, mapear columnas, elegir modos de escritura y resolver fallos de replicacion."
    ].join(" ");
  },
  getSuggestions(context: AssistantContext): AssistantSuggestion[] {
    return dedupe([...suggestionsBySection[context.section], ...globalSuggestions]).slice(0, 4);
  },
  async askExternal(input: string, context: AssistantContext): Promise<AssistantReply | null> {
    try {
      const result = await api<{ text: string }>("/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ message: input, section: context.section })
      });
      return {
        text: result.text,
        suggestions: this.getSuggestions(context)
      };
    } catch {
      return null;
    }
  },
  ask(input: string, context: AssistantContext): AssistantReply {
    const normalized = normalize(input);
    const intent = intents.find((item) => item.keys.some((key) => normalized.includes(key)));
    if (intent) return intent.answer(context);

    return {
      text: [
        `Estoy en modo guia para ${sectionNames[context.section]}.`,
        fallbackBySection(context.section),
        "Prueba con una pregunta sobre replicacion, importacion, mapeos, modos de escritura o seguridad."
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
  if (count === 0) return "Ahora no hay bases registradas; empieza en Bases de datos antes de crear el flujo.";
  if (count === 1) return "Ahora tienes 1 base registrada; agrega una segunda configuracion para usarla como destino u origen.";
  return `Ahora tienes ${count} bases registradas, suficiente para crear un flujo origen-destino.`;
}

function fallbackBySection(section: DashboardSection): string {
  if (section === "replication") return "Aqui conviene preguntar por tablas, mapeos, modos de escritura, lotes, programacion o errores de ejecucion.";
  return "Aqui puedo ayudarte a importar archivos, conectar Railway/Azure/Supabase, verificar, ver contenido, editar o eliminar configuraciones de bases.";
}
