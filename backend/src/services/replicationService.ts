import { pool } from "../db/database.js";
import type { DatabaseAdapter } from "../adapters/DatabaseAdapter.js";
import { createAdapter } from "./connectionManager.js";
import { getConfiguration } from "./dbConfigService.js";
import { logger } from "../utils/logger.js";

const BATCH_SIZE = 5000;
const activeJobs = new Map<string, AbortController>();

export interface ReplicationInput {
  sourceConfigId: string;
  destinationConfigId: string;
  sourceTable: string;
  destinationTable: string;
  createDestination: boolean;
}

async function prepare(userId: string, input: ReplicationInput) {
  const [source, destination] = await Promise.all([
    getConfiguration(input.sourceConfigId, userId),
    getConfiguration(input.destinationConfigId, userId)
  ]);
  if (!source || !destination) throw new Error("Configuración de origen o destino no encontrada");
  const sourceAdapter = createAdapter(source);
  const destinationAdapter = createAdapter(destination);
  await Promise.all([sourceAdapter.connect(), destinationAdapter.connect()]);
  try {
    await sourceAdapter.verifyReadPermission(input.sourceTable);
    const schema = await sourceAdapter.getTableSchema(input.sourceTable);
    const exists = await destinationAdapter.tableExists(input.destinationTable);
    await destinationAdapter.verifyWritePermission(input.destinationTable, exists);
    return { sourceAdapter, destinationAdapter, schema, exists };
  } catch (error) {
    await Promise.allSettled([sourceAdapter.close(), destinationAdapter.close()]);
    throw error;
  }
}

export async function previewReplication(userId: string, input: ReplicationInput) {
  const prepared = await prepare(userId, input);
  try {
    return {
      tableExists: prepared.exists,
      requiresCreation: !prepared.exists,
      createStatement: prepared.exists ? null : prepared.destinationAdapter.previewCreateTable(input.destinationTable, prepared.schema.columns),
      schema: prepared.schema
    };
  } finally {
    await Promise.allSettled([prepared.sourceAdapter.close(), prepared.destinationAdapter.close()]);
  }
}

export async function startReplication(userId: string, input: ReplicationInput) {
  const prepared = await prepare(userId, input);
  if (!prepared.exists && !input.createDestination) {
    await Promise.allSettled([prepared.sourceAdapter.close(), prepared.destinationAdapter.close()]);
    return { requiresCreation: true, createStatement: prepared.destinationAdapter.previewCreateTable(input.destinationTable, prepared.schema.columns) };
  }
  if (!prepared.exists) await prepared.destinationAdapter.createTable(input.destinationTable, prepared.schema.columns);
  const result = await pool.query(
    `INSERT INTO replications (user_id,source_config_id,destination_config_id,source_table,destination_table,status,started_at)
     VALUES ($1,$2,$3,$4,$5,'starting',now()) RETURNING id`,
    [userId, input.sourceConfigId, input.destinationConfigId, input.sourceTable, input.destinationTable]
  );
  const id = result.rows[0].id as string;
  const controller = new AbortController(); activeJobs.set(id, controller);
  void runJob(id, input, prepared.sourceAdapter, prepared.destinationAdapter, controller);
  return { id, status: "starting", requiresCreation: false };
}

function normalizeRows(rows: Record<string, unknown>[], destination: DatabaseAdapter): Record<string, unknown>[] {
  if (destination.config.engine === "mongodb") return rows;
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Date)) {
      if ("toHexString" in value && typeof value.toHexString === "function") return [key, value.toHexString()];
      return [key, JSON.stringify(value)];
    }
    return [key, value];
  })));
}

async function runJob(id: string, input: ReplicationInput, source: DatabaseAdapter, destination: DatabaseAdapter, controller: AbortController) {
  let copied = 0;
  try {
    await pool.query("UPDATE replications SET status='running',updated_at=now() WHERE id=$1", [id]);
    while (!controller.signal.aborted) {
      const rows = await source.readBatch(input.sourceTable, copied, BATCH_SIZE);
      if (!rows.length) break;
      copied += await destination.insertBatch(input.destinationTable, normalizeRows(rows, destination));
      await pool.query("UPDATE replications SET records_copied=$2,lag_seconds=0,updated_at=now() WHERE id=$1", [id, copied]);
      if (rows.length < BATCH_SIZE) break;
    }
    const status = controller.signal.aborted ? "stopped" : "completed";
    await pool.query("UPDATE replications SET status=$2,records_copied=$3,stopped_at=now(),updated_at=now() WHERE id=$1", [id, status, copied]);
    logger.info({ replicationId: id, copied, status }, "Replication finished");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Replication failed";
    await pool.query("UPDATE replications SET status='failed',last_error=$2,stopped_at=now(),updated_at=now() WHERE id=$1", [id, message]).catch(() => undefined);
    logger.error({ error, replicationId: id }, "Replication failed");
  } finally {
    activeJobs.delete(id);
    await Promise.allSettled([source.close(), destination.close()]);
  }
}

export async function stopReplication(id: string, userId: string): Promise<boolean> {
  const result = await pool.query("SELECT id FROM replications WHERE id=$1 AND user_id=$2 AND status IN ('starting','running')", [id, userId]);
  if (!result.rowCount) return false;
  activeJobs.get(id)?.abort();
  await pool.query("UPDATE replications SET status='stopped',stopped_at=now(),updated_at=now() WHERE id=$1", [id]);
  return true;
}

export async function listReplications(userId: string) {
  return (await pool.query("SELECT * FROM replications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [userId])).rows;
}
