import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/role.js";
import { deleteUserByAdmin, getAdminStats, listUsers, updateUserByAdmin } from "../services/adminService.js";
import { listConfigurations, publicConfig } from "../services/dbConfigService.js";

const filtersSchema = z.object({
  search: z.string().max(100).optional(),
  role: z.enum(["admin", "user"]).optional(),
  active: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  last7Days: z.enum(["true", "false"]).transform((v) => v === "true").optional()
});
const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().email().max(254).optional(),
  role: z.enum(["admin", "user"]).optional(),
  isActive: z.boolean().optional()
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const guards = { preHandler: [authenticate, requireAdmin] };
  app.get("/stats", guards, async () => getAdminStats());
  app.get("/users", guards, async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ message: "Filtros inválidos" });
    return { users: await listUsers(parsed.data) };
  });
  app.patch("/users/:id", guards, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Datos inválidos", issues: parsed.error.flatten() });
    if (id === request.user.id && parsed.data.isActive === false) return reply.code(400).send({ message: "No puedes desactivar tu propia cuenta" });
    const user = await updateUserByAdmin(id, parsed.data);
    if (!user) return reply.code(404).send({ message: "Usuario no encontrado" });
    return { user };
  });
  app.delete("/users/:id", guards, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (id === request.user.id) return reply.code(400).send({ message: "No puedes eliminar tu propia cuenta" });
    if (!await deleteUserByAdmin(id)) return reply.code(404).send({ message: "Usuario no encontrado" });
    return reply.code(204).send();
  });
  app.get("/users/:id/configurations", guards, async (request) => {
    const configs = await listConfigurations((request.params as { id: string }).id, false);
    return { configurations: configs.map(publicConfig) };
  });
}
