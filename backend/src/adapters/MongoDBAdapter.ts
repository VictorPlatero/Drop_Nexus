import { MongoClient, type Db } from "mongodb";
import type { DatabaseAdapter } from "./DatabaseAdapter.js";
import type { ColumnSchema, ConnectionTest, DbConfiguration, TableSchema } from "../types/index.js";

function mongoType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return "date";
  if (Buffer.isBuffer(value)) return "binary";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

export class MongoDBAdapter implements DatabaseAdapter {
  private client?: MongoClient;
  private database?: Db;
  constructor(public readonly config: DbConfiguration) {}
  private uri(): string {
    if (typeof this.config.options?.connectionString === "string") return this.config.options.connectionString;
    const credentials = this.config.username ? `${encodeURIComponent(this.config.username)}:${encodeURIComponent(this.config.password ?? "")}@` : "";
    return `mongodb://${credentials}${this.config.host ?? "localhost"}:${this.config.port ?? 27017}`;
  }
  async connect(): Promise<void> {
    if (this.client) return;
    this.client = new MongoClient(this.uri(), { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, maxPoolSize: 3 });
    await this.client.connect();
    this.database = this.client.db(this.config.database);
    await this.database.command({ ping: 1 });
  }
  async close(): Promise<void> { await this.client?.close(); this.client = undefined; this.database = undefined; }
  private db(): Db { if (!this.database) throw new Error("Adapter not connected"); return this.database; }
  async testConnection(): Promise<ConnectionTest> {
    const start = performance.now();
    try { await this.connect(); await this.db().command({ ping: 1 }); return { ok: true, latencyMs: Math.round(performance.now() - start) }; }
    catch (error) { return { ok: false, latencyMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : "Connection failed" }; }
  }
  async listTables(): Promise<string[]> {
    return (await this.db().listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
  }
  async getTableSchema(name: string): Promise<TableSchema> {
    const sample = await this.db().collection(name).find({}).limit(100).toArray();
    const fields = new Map<string, { types: Set<string>; nullable: boolean }>();
    for (const document of sample) {
      for (const [key, value] of Object.entries(document)) {
        const current = fields.get(key) ?? { types: new Set<string>(), nullable: false };
        current.types.add(mongoType(value)); current.nullable ||= value === null; fields.set(key, current);
      }
    }
    return { name, columns: [...fields.entries()].map(([field, info]) => ({ name: field, dataType: [...info.types].join(" | ") || "unknown", nullable: info.nullable, primaryKey: field === "_id", foreignKey: false })) };
  }
  async tableExists(name: string): Promise<boolean> { return (await this.db().listCollections({ name }).toArray()).length > 0; }
  previewCreateTable(table: string, columns: ColumnSchema[]): string {
    const properties = Object.fromEntries(columns.map((column) => [column.name, { bsonType: this.bsonType(column.dataType) }]));
    const required = columns.filter((column) => !column.nullable && column.name !== "_id").map((column) => column.name);
    return JSON.stringify({ create: table, validator: { $jsonSchema: { bsonType: "object", required, properties } } }, null, 2);
  }
  private bsonType(type: string): string {
    const lower = type.toLowerCase();
    if (/bool/.test(lower)) return "bool";
    if (/int|long|bigint/.test(lower)) return "long";
    if (/decimal|double|float|numeric|real/.test(lower)) return "double";
    if (/date|time/.test(lower)) return "date";
    if (/binary|blob|bytea/.test(lower)) return "binData";
    if (/object|json|document/.test(lower)) return "object";
    if (/array/.test(lower)) return "array";
    return "string";
  }
  async createTable(table: string, columns: ColumnSchema[]): Promise<void> {
    const command = JSON.parse(this.previewCreateTable(table, columns)) as Record<string, unknown>;
    await this.db().command(command);
  }
  async countRows(table: string): Promise<number> { return this.db().collection(table).estimatedDocumentCount(); }
  async clearTable(table: string): Promise<void> { await this.db().collection(table).deleteMany({}); }
  async readBatch(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
    return this.db().collection(table).find({}).skip(offset).limit(limit).toArray();
  }
  async insertBatch(table: string, rows: Record<string, unknown>[]): Promise<number> {
    if (!rows.length) return 0;
    const normalized = rows.map(({ _id, ...row }) => row);
    return (await this.db().collection(table).insertMany(normalized, { ordered: true })).insertedCount;
  }
  async upsertBatch(table: string, rows: Record<string, unknown>[], keyColumns: string[]): Promise<number> {
    if (!rows.length) return 0;
    if (!keyColumns.length) throw new Error("UPsert requiere una clave primaria");
    await this.db().collection(table).bulkWrite(rows.map((row) => ({
      updateOne: {
        filter: Object.fromEntries(keyColumns.map((column) => [column, row[column]])),
        update: { $set: Object.fromEntries(Object.entries(row).filter(([column]) => column !== "_id")) },
        upsert: true
      }
    })), { ordered: false });
    return rows.length;
  }
  async verifyReadPermission(table: string): Promise<void> { await this.db().collection(table).findOne({}); }
  async verifyWritePermission(_table: string, _exists: boolean): Promise<void> { await this.db().command({ connectionStatus: 1, showPrivileges: false }); }
}
