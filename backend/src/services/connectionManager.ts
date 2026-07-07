import type { DatabaseAdapter } from "../adapters/DatabaseAdapter.js";
import { MongoDBAdapter } from "../adapters/MongoDBAdapter.js";
import { MySQLAdapter } from "../adapters/MySQLAdapter.js";
import { PostgresAdapter } from "../adapters/PostgresAdapter.js";
import { SQLServerAdapter } from "../adapters/SQLServerAdapter.js";
import { SQLiteAdapter } from "../adapters/SQLiteAdapter.js";
import type { ConnectionTest, DbConfiguration } from "../types/index.js";
import { FileDatabaseAdapter } from "../adapters/FileDatabaseAdapter.js";

export function createAdapter(config: DbConfiguration): DatabaseAdapter {
  if (config.options?.storageMode === "fileCatalog") return new FileDatabaseAdapter(config);
  switch (config.engine) {
    case "postgresql": return new PostgresAdapter(config);
    case "mysql":
    case "mariadb": return new MySQLAdapter(config);
    case "sqlserver": return new SQLServerAdapter(config);
    case "sqlite": return new SQLiteAdapter(config);
    case "mongodb": return new MongoDBAdapter(config);
    case "excel": throw new Error("Excel solo esta disponible mediante archivos importados");
    case "oracle": throw new Error("Oracle solo esta disponible mediante archivos importados");
  }
}

export async function withAdapter<T>(config: DbConfiguration, task: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
  const adapter = createAdapter(config);
  const timeoutMs = Number(config.options?.connectionTimeoutMs ?? 15000);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Tiempo de conexion agotado (${Math.round(timeoutMs / 1000)} segundos)`)), timeoutMs);
  });
  try {
    await Promise.race([adapter.connect(), timeout]);
    return await task(adapter);
  } finally {
    await adapter.close().catch(() => undefined);
  }
}

export async function testAdapterConnection(config: DbConfiguration): Promise<ConnectionTest> {
  const adapter = createAdapter(config);
  try {
    return await adapter.testConnection();
  } finally {
    await adapter.close().catch(() => undefined);
  }
}
