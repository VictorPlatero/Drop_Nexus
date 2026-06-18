import { z } from "zod";

const columnMappingSchema = z.object({
  source: z.string().min(1).max(255),
  destination: z.string().min(1).max(255),
  transform: z.enum(["none", "string", "number", "boolean", "date", "json"]).default("none")
});

const tableMappingSchema = z.object({
  sourceTable: z.string().min(1).max(255),
  destinationTable: z.string().min(1).max(255),
  columnMappings: z.array(columnMappingSchema).max(500).default([])
});

export const replicationRequestSchema = z.object({
  sourceConfigId: z.coerce.string().min(1).max(100),
  destinationConfigId: z.coerce.string().min(1).max(100),
  sourceTable: z.string().min(1).max(255).optional(),
  destinationTable: z.string().min(1).max(255).optional(),
  tables: z.array(tableMappingSchema).min(1).max(100).optional(),
  columnMappings: z.array(columnMappingSchema).max(500).default([]),
  createDestination: z.boolean().default(false),
  writeMode: z.enum(["insert", "upsert", "replace", "truncate"]).default("insert"),
  batchSize: z.coerce.number().int().min(100).max(10_000).default(1000),
  maxRetries: z.coerce.number().int().min(0).max(10).default(3),
  incremental: z.boolean().default(true),
  scheduleMinutes: z.coerce.number().int().min(5).max(43_200).optional()
}).superRefine((value, context) => {
  const tables = value.tables ?? (
    value.sourceTable && value.destinationTable
      ? [{ sourceTable: value.sourceTable, destinationTable: value.destinationTable }]
      : []
  );
  if (!tables.length) {
    context.addIssue({ code: "custom", message: "Selecciona al menos una tabla para replicar" });
  }
  if (value.sourceConfigId === value.destinationConfigId && tables.some((table) => table.sourceTable === table.destinationTable)) {
    context.addIssue({ code: "custom", message: "No se puede replicar una tabla sobre sí misma" });
  }
});

export function assertSafeIdentifier(identifier: string): void {
  if (!/^[\p{L}\p{N}_$ .-]+$/u.test(identifier) || identifier.includes("\0")) {
    throw new Error("Identificador de tabla no permitido");
  }
}

export type ReplicationRequest = z.infer<typeof replicationRequestSchema>;
