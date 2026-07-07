import { pool } from "../db/database.js";
import { removeOwnedCatalog } from "./fileCatalog.js";
import { logger } from "../utils/logger.js";

export async function cleanupExpiredConfigurations(): Promise<number> {
  const expired = (await pool.query(
    "SELECT id, user_id, database_name FROM db_configurations WHERE expires_at IS NOT NULL AND expires_at <= now()"
  )).rows as Array<{ id: string; user_id: string; database_name?: string }>;

  for (const config of expired) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM replications WHERE source_config_id=$1 OR destination_config_id=$1",
        [config.id]
      );
      await client.query("DELETE FROM db_configurations WHERE id=$1", [config.id]);
      await client.query("COMMIT");
      await removeOwnedCatalog(config.database_name, String(config.user_id));
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error({ error, configId: config.id }, "Expired configuration cleanup failed");
    } finally {
      client.release();
    }
  }

  if (expired.length) logger.info({ count: expired.length }, "Expired configurations removed");
  return expired.length;
}

export function startExpirationCleanup(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void cleanupExpiredConfigurations();
  }, 15 * 60 * 1000);
  timer.unref();
  return timer;
}
