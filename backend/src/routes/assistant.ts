import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { answerAssistantMessage } from "../services/assistantService.js";

const assistantChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  section: z.enum(["replication", "configurations"])
});

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  app.post("/chat", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = assistantChatSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Consulta invalida" });
    try {
      return await answerAssistantMessage(request.user.id, parsed.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo consultar el asistente";
      if (message.includes("OPENAI_API_KEY")) return reply.code(503).send({ message });
      request.log.error({ error }, "Assistant chat failed");
      return reply.code(502).send({ message });
    }
  });
}
