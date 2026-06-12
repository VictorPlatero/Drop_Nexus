import type { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { getUserById } from "../services/userService.js";

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/profile", { preHandler: [authenticate] }, async (request, reply) => {
    const user = await getUserById(request.user.id);
    if (!user) return reply.code(404).send({ message: "Usuario no encontrado" });
    return { user };
  });
}
