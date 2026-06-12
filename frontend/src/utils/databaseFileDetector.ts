export type DetectableEngine = "postgresql" | "mysql" | "mariadb" | "sqlserver" | "oracle" | "sqlite" | "mongodb";

export interface DetectionResult {
  engine?: DetectableEngine;
  confidence: "high" | "medium" | "unknown";
  reason: string;
}

const SQLITE_HEADER = "SQLite format 3\u0000";

export async function detectDatabaseEngine(file: File): Promise<DetectionResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

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
  const scores: Record<Exclude<DetectableEngine, "sqlite" | "mongodb">, number> = {
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
    mongodb: "MongoDB"
  };
  return names[engine];
}
