import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { DB_ENGINES } from "../types/index.js";
import {
  createConfiguration,
  deleteConfiguration,
  getConfiguration,
  listConfigurations,
  publicConfig,
  updateConfiguration
} from "../services/dbConfigService.js";
import { withAdapter } from "../services/connectionManager.js";
import {
  exportCatalog,
  importDatabaseFile,
  removeOwnedCatalog,
  validateOwnedCatalogReference
} from "../services/fileCatalog.js";
import { maxDatabaseFileSizeBytes, maxDatabaseFileSizeMb } from "../utils/uploadLimits.js";

const configSchema = z.object({
  name: z.string().trim().min(2).max(100),
  engine: z.enum(DB_ENGINES),
  database: z.string().trim().min(1).max(1000),
  options: z.record(z.string(), z.unknown()).optional()
});
const exportFormatSchema = z.enum(["xlsx", "sqlite", "json"]);

export async function configurationRoutes(app: FastifyInstance): Promise<void> {
  const guards = { preHandler: [authenticate] };

  app.get("/", guards, async (request) => ({
    configurations: (await listConfigurations(request.user.id, true)).map(publicConfig)
  }));

  app.post("/database-upload/:engine", guards, async (request, reply) => {
    const engineResult = z.enum(DB_ENGINES).safeParse((request.params as { engine: string }).engine);
    if (!engineResult.success) return reply.code(400).send({ message: "Modelo de base de datos no válido" });
    try {
      const file = await request.file({ limits: { files: 1, fileSize: maxDatabaseFileSizeBytes() } });
      if (!file) return reply.code(400).send({ message: "Selecciona un archivo de base de datos" });
      const imported = await importDatabaseFile(file, request.user.id, engineResult.data);
      return reply.code(201).send({
        database: imported.catalogPath,
        originalName: imported.originalName,
        size: imported.size,
        tableCount: imported.tableCount
      });
    } catch (error) {
      request.log.error({ error, engine: engineResult.data }, "Database file import failed");
      const statusCode = (error as { statusCode?: number }).statusCode;
      const message = statusCode === 413
        ? `El archivo supera el limite de ${maxDatabaseFileSizeMb()} MB`
        : error instanceof Error ? error.message : "No se pudo importar la base de datos";
      return reply.code(statusCode && statusCode < 500 ? statusCode : 400).send({ message });
    }
  });

  app.post("/", guards, async (request, reply) => {
    const parsed = configSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Configuración inválida", issues: parsed.error.flatten() });
    if (parsed.data.options?.storageMode !== "fileCatalog") {
      return reply.code(400).send({ message: "Debes subir la base de datos desde tu computadora" });
    }
    if (!await validateOwnedCatalogReference(parsed.data.database, request.user.id, parsed.data.engine)) {
      return reply.code(400).send({ message: "El archivo importado no pertenece al usuario o no corresponde al motor seleccionado" });
    }
    const config = await createConfiguration(request.user.id, parsed.data);
    return reply.code(201).send({ configuration: publicConfig(config) });
  });

  app.patch("/:id", guards, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const current = await getConfiguration(id, request.user.id);
    if (!current) return reply.code(404).send({ message: "Base de datos no encontrada" });
    const parsed = configSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Configuración inválida", issues: parsed.error.flatten() });
    if (parsed.data.engine && parsed.data.engine !== current.engine && !parsed.data.database) {
      return reply.code(400).send({ message: "Para cambiar el motor debes subir un nuevo archivo compatible" });
    }
    if (parsed.data.database && parsed.data.options?.storageMode !== "fileCatalog") {
      return reply.code(400).send({ message: "Debes subir la base de datos desde tu computadora" });
    }
    if (parsed.data.database && !await validateOwnedCatalogReference(parsed.data.database, request.user.id, parsed.data.engine ?? current.engine)) {
      return reply.code(400).send({ message: "Archivo de base de datos no autorizado o incompatible con el motor seleccionado" });
    }
    const config = await updateConfiguration(id, request.user.id, parsed.data);
    if (!config) return reply.code(404).send({ message: "Base de datos no encontrada" });
    if (parsed.data.database && parsed.data.database !== current.database) {
      await removeOwnedCatalog(current.database, request.user.id);
    }
    return { configuration: publicConfig(config) };
  });

  app.delete("/:id", guards, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const current = await getConfiguration(id, request.user.id);
    if (!current || !await deleteConfiguration(id, request.user.id)) {
      return reply.code(404).send({ message: "Base de datos no encontrada" });
    }
    await removeOwnedCatalog(current.database, request.user.id);
    return reply.code(204).send();
  });

  app.post("/:id/test", guards, async (request, reply) => {
    const config = await getConfiguration((request.params as { id: string }).id, request.user.id);
    if (!config) return reply.code(404).send({ message: "Base de datos no encontrada" });
    return withAdapter(config, (adapter) => adapter.testConnection());
  });

  app.get("/:id/export/:format", guards, async (request, reply) => {
    const { id, format } = request.params as { id: string; format: string };
    const parsedFormat = exportFormatSchema.safeParse(format);
    if (!parsedFormat.success) return reply.code(400).send({ message: "Formato de descarga no valido. Usa xlsx, sqlite o json." });
    const config = await getConfiguration(id, request.user.id);
    if (!config) return reply.code(404).send({ message: "Base de datos no encontrada" });
    if (!config.database || config.options?.storageMode !== "fileCatalog") {
      return reply.code(400).send({ message: "Solo se pueden descargar bases importadas como archivo. Las conexiones externas deben exportarse desde su motor." });
    }
    if (!await validateOwnedCatalogReference(config.database, request.user.id, config.engine)) {
      return reply.code(400).send({ message: "Archivo de base de datos no autorizado o incompatible con el motor seleccionado" });
    }
    try {
      const exported = await exportCatalog(config.database, parsedFormat.data);
      return reply
        .header("Content-Type", exported.contentType)
        .header("Content-Disposition", `attachment; filename="${exported.filename}"`)
        .send(exported.buffer);
    } catch (error) {
      request.log.error({ error, id, format }, "Database export failed");
      return reply.code(400).send({ message: error instanceof Error ? error.message : "No se pudo exportar la base modificada" });
    }
  });

  app.get("/:id/tables", guards, async (request, reply) => {
    const config = await getConfiguration((request.params as { id: string }).id, request.user.id);
    if (!config) return reply.code(404).send({ message: "Base de datos no encontrada" });
    return { tables: await withAdapter(config, (adapter) => adapter.listTables()) };
  });
}
