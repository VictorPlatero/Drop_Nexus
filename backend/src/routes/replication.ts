import type { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { replicationRequestSchema } from "../validations/replicationValidation.js";
import { listReplications, previewReplication, replicationReport, resumeReplication, retryReplication, startReplication, stopReplication } from "../services/replicationService.js";

export async function replicationRoutes(app: FastifyInstance): Promise<void> {
  const guards = { preHandler: [authenticate] };
  app.get("/", guards, async (request) => ({ replications: await listReplications(request.user.id) }));
  app.post("/preview", guards, async (request, reply) => {
    const parsed = replicationRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Solicitud inválida" });
    return previewReplication(request.user.id, parsed.data);
  });
  app.post("/start", guards, async (request, reply) => {
    const parsed = replicationRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Solicitud inválida" });
    return reply.code(202).send(await startReplication(request.user.id, parsed.data));
  });
  app.post("/:id/stop", guards, async (request, reply) => {
    if (!await stopReplication((request.params as { id: string }).id, request.user.id)) return reply.code(404).send({ message: "Replicación activa no encontrada" });
    return { status: "stopped" };
  });
  app.post("/:id/resume", guards, async (request, reply) => {
    if (!await resumeReplication((request.params as { id: string }).id, request.user.id)) return reply.code(404).send({ message: "Replicación reanudable no encontrada" });
    return { status: "starting" };
  });
  app.post("/:id/retry", guards, async (request, reply) => {
    if (!await retryReplication((request.params as { id: string }).id, request.user.id)) return reply.code(404).send({ message: "Replicación no encontrada" });
    return { status: "starting" };
  });
  app.get("/:id/report", guards, async (request, reply) => {
    try { return await replicationReport((request.params as { id: string }).id, request.user.id); }
    catch (error) { return reply.code(404).send({ message: error instanceof Error ? error.message : "Replicación no encontrada" }); }
  });
}
