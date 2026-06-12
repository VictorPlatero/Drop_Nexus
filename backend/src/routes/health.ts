import type { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { diagnoseConfiguration, getHealth } from "../services/healthService.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", { preHandler: [authenticate] }, async (request) => getHealth(request.user.id));
  app.post("/:configId/diagnose", { preHandler: [authenticate] }, async (request, reply) => {
    const configId = (request.params as { configId: string }).configId;
    try {
      return await diagnoseConfiguration(configId, request.user.id);
    } catch (error) {
      return reply.code(404).send({
        message: error instanceof Error ? error.message : "Base de datos no encontrada"
      });
    }
  });
}
