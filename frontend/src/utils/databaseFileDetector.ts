export type DetectableEngine = "postgresql" | "mysql" | "mariadb" | "sqlserver" | "oracle" | "sqlite" | "mongodb" | "excel";

export interface DetectionResult {
  engine?: DetectableEngine;
  confidence: "high" | "medium" | "unknown";
  reason: string;
}

export interface FileValidationResult {
  valid: boolean;
  message?: string;
  warning?: string;
}

const SQLITE_HEADER = "SQLite format 3\u0000";
const DEFAULT_MAX_DATABASE_FILE_SIZE_MB = 500;

const engineExtensions: Record<DetectableEngine, string[]> = {
  postgresql: [".sql"],
  mysql: [".sql"],
  mariadb: [".sql"],
  sqlserver: [".sql", ".bak"],
  oracle: [".sql"],
  sqlite: [".db", ".sqlite", ".sqlite3"],
  mongodb: [".json", ".ndjson"],
  excel: [".xlsx", ".xls", ".csv"]
};

const globalExtensions = new Set(Object.values(engineExtensions).flat());

export function maxDatabaseFileSizeMb(): number {
  const configured = Number(import.meta.env.VITE_MAX_DATABASE_FILE_SIZE_MB ?? DEFAULT_MAX_DATABASE_FILE_SIZE_MB);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_DATABASE_FILE_SIZE_MB;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

export async function validateDatabaseFile(file: File | undefined, engine: string): Promise<FileValidationResult> {
  if (!file) return { valid: false, message: "Selecciona un archivo de base de datos" };

  const name = file.name.trim();
  if (!name) return { valid: false, message: "El archivo no tiene nombre valido" };
  if (name.length > 255) return { valid: false, message: "El nombre del archivo supera 255 caracteres" };
  if (/[\u0000-\u001F<>:"/\\|?*]/.test(name)) return { valid: false, message: "El nombre del archivo contiene caracteres no permitidos" };
  if (file.size <= 0) return { valid: false, message: "El archivo esta vacio" };

  const maxBytes = maxDatabaseFileSizeMb() * 1024 * 1024;
  if (file.size > maxBytes) {
    return { valid: false, message: `El archivo pesa ${formatFileSize(file.size)} y supera el limite de ${maxDatabaseFileSizeMb()} MB` };
  }

  const extension = fileExtension(name);
  if (!extension || !globalExtensions.has(extension)) {
    return { valid: false, message: "Formato no soportado. Usa .sql, .bak, .db, .sqlite, .sqlite3, .json, .ndjson, .xlsx, .xls o .csv" };
  }

  const expected = engineExtensions[engine as DetectableEngine];
  if (!expected) return { valid: false, message: "Modelo de base de datos no valido" };
  if (!expected.includes(extension)) {
    return {
      valid: false,
      message: `El archivo ${extension} no corresponde a ${displayEngine(engine as DetectableEngine)}. Formatos permitidos: ${expected.join(", ")}`
    };
  }

  if (extension === ".sql") {
    const detected = await detectDatabaseEngine(file);
    if (detected.engine && detected.confidence === "high" && detected.engine !== engine) {
      return {
        valid: false,
        message: `El script parece de ${displayEngine(detected.engine)}. Selecciona ese motor o sube un archivo compatible con ${displayEngine(engine as DetectableEngine)}`
      };
    }
  }

  if ([".db", ".sqlite", ".sqlite3"].includes(extension)) {
    const header = new TextDecoder().decode(await file.slice(0, 16).arrayBuffer());
    if (header !== SQLITE_HEADER) return { valid: false, message: "El archivo no tiene una cabecera SQLite valida" };
  }

  if ([".sql", ".json", ".ndjson", ".csv"].includes(extension)) {
    const sampleBuffer = await file.slice(0, Math.min(file.size, 4096)).arrayBuffer();
    const sampleText = new TextDecoder().decode(sampleBuffer);
    if (sampleText.includes("\u0000")) return { valid: false, message: "El archivo parece binario. Selecciona un export compatible" };
    if (!sampleText.trim()) return { valid: false, message: "El archivo no contiene datos legibles" };
  }

  return extension === ".bak"
    ? { valid: true, warning: "Los .bak requieren un SQL Server de restauracion configurado en el servidor" }
    : { valid: true };
}

export async function detectDatabaseEngine(file: File): Promise<DetectionResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "bak") {
    return { engine: "sqlserver", confidence: "high", reason: "Respaldo binario de SQL Server (.bak)" };
  }

  if (["xlsx", "xls", "csv"].includes(extension)) {
    return { engine: "excel", confidence: "high", reason: "Archivo tabular compatible con Excel" };
  }

  if (["db", "sqlite", "sqlite3"].includes(extension)) {
    const header = new TextDecoder().decode(await file.slice(0, 16).arrayBuffer());
    return header === SQLITE_HEADER
      ? { engine: "sqlite", confidence: "high", reason: "Cabecera SQLite reconocida" }
      : { engine: "sqlite", confidence: "medium", reason: "Extensión de archivo SQLite" };
  }

  if (extension === "json" || extension === "ndjson") {
    const sample = await file.slice(0, 64 * 1024).text();
    try {
      if (extension === "ndjson") {
        const firstLine = sample.split(/\r?\n/).find(Boolean);
        if (firstLine) JSON.parse(firstLine);
      } else {
        JSON.parse(sample);
      }
      return { engine: "mongodb", confidence: "high", reason: "Documento JSON válido" };
    } catch {
      return { engine: "mongodb", confidence: "medium", reason: "Extensión documental JSON/NDJSON" };
    }
  }

  if (extension !== "sql") {
    return { confidence: "unknown", reason: "Formato no reconocido" };
  }

  const sample = (await file.slice(0, 256 * 1024).text()).toLowerCase();
  const scores: Record<Exclude<DetectableEngine, "sqlite" | "mongodb" | "excel">, number> = {
    postgresql: 0,
    mysql: 0,
    mariadb: 0,
    sqlserver: 0,
    oracle: 0
  };

  const score = (engine: keyof typeof scores, pattern: RegExp, points: number) => {
    if (pattern.test(sample)) scores[engine] += points;
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

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[keyof typeof scores, number]>;
  const [best, bestScore] = ranked[0]!;
  const secondScore = ranked[1]?.[1] ?? 0;

  if (bestScore >= 4 && bestScore > secondScore) {
    return { engine: best, confidence: "high", reason: `Firma de ${displayEngine(best)} reconocida` };
  }
  if (bestScore >= 2 && bestScore > secondScore) {
    return { engine: best, confidence: "medium", reason: `Sintaxis compatible con ${displayEngine(best)}` };
  }
  return { confidence: "unknown", reason: "El script SQL no contiene una firma inequívoca" };
}

export function displayEngine(engine: DetectableEngine): string {
  const names: Record<DetectableEngine, string> = {
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
