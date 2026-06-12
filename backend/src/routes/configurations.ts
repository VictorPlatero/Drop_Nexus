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
  importDatabaseFile,
  isOwnedCatalogPath,
  removeOwnedCatalog
} from "../services/fileCatalog.js";

const configSchema = z.object({
  name: z.string().trim().min(2).max(100),
  engine: z.enum(DB_ENGINES),
  database: z.string().trim().min(1).max(1000),
  options: z.record(z.string(), z.unknown()).optional()
});

export async function configurationRoutes(app: FastifyInstance): Promise<void> {
  const guards = { preHandler: [authenticate] };

  app.get("/", guards, async (request) => ({
    configurations: (await listConfigurations(request.user.id, true)).map(publicConfig)
  }));

  app.post("/database-upload/:engine", guards, async (request, reply) => {
    const engineResult = z.enum(DB_ENGINES).safeParse((request.params as { engine: string }).engine);
    if (!engineResult.success) return reply.code(400).send({ message: "Modelo de base de datos no válido" });
    const file = await request.file({ limits: { files: 1, fileSize: 100 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ message: "Selecciona un archivo de base de datos" });
    try {
      const imported = await importDatabaseFile(file, request.user.id, engineResult.data);
      return reply.code(201).send({
        database: imported.catalogPath,
        originalName: imported.originalName,
        size: imported.size,
        tableCount: imported.tableCount
      });
    } catch (error) {
      request.log.error({ error, engine: engineResult.data }, "Database file import failed");
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "No se pudo importar la base de datos"
      });
    }
  });

  app.post("/", guards, async (request, reply) => {
    const parsed = configSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Configuración inválida", issues: parsed.error.flatten() });
    if (!isOwnedCatalogPath(parsed.data.database, request.user.id) || parsed.data.options?.storageMode !== "fileCatalog") {
      return reply.code(400).send({ message: "Debes subir la base de datos desde tu computadora" });
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
    if (parsed.data.database && !isOwnedCatalogPath(parsed.data.database, request.user.id)) {
      return reply.code(400).send({ message: "Archivo de base de datos no autorizado" });
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

  app.get("/:id/tables", guards, async (request, reply) => {
    const config = await getConfiguration((request.params as { id: string }).id, request.user.id);
    if (!config) return reply.code(404).send({ message: "Base de datos no encontrada" });
    return { tables: await withAdapter(config, (adapter) => adapter.listTables()) };
  });
}
