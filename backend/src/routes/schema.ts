import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { getConfiguration } from "../services/dbConfigService.js";
import {
  databaseToExcelXml,
  compareSchemas,
  extractDatabaseData,
  extractSchema,
  extractTableData,
  schemaToHtml,
  schemaToMarkdown,
  tableStatistics,
  tableToCsv
} from "../services/schemaExtractor.js";

function downloadName(value: string): string {
  return value.replace(/[^\p{L}\p{N}_.-]+/gu, "_").slice(0, 80) || "database";
}

export async function schemaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/:configId", { preHandler: [authenticate] }, async (request, reply) => {
    const configId = (request.params as { configId: string }).configId;
    const config = await getConfiguration(configId, request.user.id);
    if (!config) return reply.code(404).send({ message: "Configuración no encontrada" });
    return { database: config.name, tables: await extractSchema(configId, request.user.id) };
  });

  app.get("/:configId/data/:table", { preHandler: [authenticate] }, async (request, reply) => {
    const { configId, table } = request.params as { configId: string; table: string };
    const query = z.object({
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "Paginación inválida" });
    if (!await getConfiguration(configId, request.user.id)) {
      return reply.code(404).send({ message: "Configuración no encontrada" });
    }
    try {
      return await extractTableData(configId, request.user.id, table, query.data.offset, query.data.limit);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : "No se pudieron cargar los datos" });
    }
  });

  app.get("/:configId/statistics/:table", { preHandler: [authenticate] }, async (request, reply) => {
    const { configId, table } = request.params as { configId: string; table: string };
    try { return await tableStatistics(configId, request.user.id, table); }
    catch (error) { return reply.code(404).send({ message: error instanceof Error ? error.message : "No se pudieron calcular estadísticas" }); }
  });

  app.get("/:configId/compare/:destinationId", { preHandler: [authenticate] }, async (request, reply) => {
    const { configId, destinationId } = request.params as { configId: string; destinationId: string };
    try { return { comparison: await compareSchemas(configId, destinationId, request.user.id) }; }
    catch (error) { return reply.code(404).send({ message: error instanceof Error ? error.message : "No se pudieron comparar los esquemas" }); }
  });

  app.get("/:configId/export/documentation/:format", { preHandler: [authenticate] }, async (request, reply) => {
    const { configId, format } = request.params as { configId: string; format: string };
    const config = await getConfiguration(configId, request.user.id);
    if (!config) return reply.code(404).send({ message: "Configuración no encontrada" });
    const tables = await extractSchema(configId, request.user.id);
    if (format === "html") return reply.header("Content-Type", "text/html; charset=utf-8").header("Content-Disposition", `attachment; filename="${downloadName(config.name)}.html"`).send(schemaToHtml(config.name, tables));
    if (format === "markdown") return reply.header("Content-Type", "text/markdown; charset=utf-8").header("Content-Disposition", `attachment; filename="${downloadName(config.name)}.md"`).send(schemaToMarkdown(config.name, tables));
    return reply.code(400).send({ message: "Formato no compatible" });
  });

  app.get("/:configId/export/json", { preHandler: [authenticate] }, async (request, reply) => {
    const configId = (request.params as { configId: string }).configId;
    const config = await getConfiguration(configId, request.user.id);
    if (!config) return reply.code(404).send({ message: "Configuración no encontrada" });
    return reply.header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${downloadName(config.name)}.json"`)
      .send(JSON.stringify(await extractDatabaseData(configId, request.user.id), null, 2));
  });

  app.get("/:configId/export/excel", { preHandler: [authenticate] }, async (request, reply) => {
    const configId = (request.params as { configId: string }).configId;
    const config = await getConfiguration(configId, request.user.id);
    if (!config) return reply.code(404).send({ message: "Configuración no encontrada" });
    return reply.header("Content-Type", "application/vnd.ms-excel; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${downloadName(config.name)}.xls"`)
      .send(databaseToExcelXml(await extractDatabaseData(configId, request.user.id)));
  });

  app.get("/:configId/export/csv/:table", { preHandler: [authenticate] }, async (request, reply) => {
    const { configId, table } = request.params as { configId: string; table: string };
    const config = await getConfiguration(configId, request.user.id);
    if (!config) return reply.code(404).send({ message: "Configuración no encontrada" });
    const selected = (await extractDatabaseData(configId, request.user.id)).tables.find((item) => item.name === table);
    if (!selected) return reply.code(404).send({ message: "Tabla o colección no encontrada" });
    return reply.header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${downloadName(config.name)}_${downloadName(table)}.csv"`)
      .send(`\uFEFF${tableToCsv(selected)}`);
  });
}
