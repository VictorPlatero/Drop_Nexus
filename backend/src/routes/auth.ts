import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { getUserById, loginUser, registerUser } from "../services/userService.js";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(6).max(128)
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128)
});

function loginValidationMessage(error: z.ZodError): string {
  return error.issues.some((issue) => issue.path[0] === "email")
    ? "Correo invalido. Escribe el correo completo, por ejemplo victorplateromaron58@gmail.com."
    : "Credenciales invalidas";
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Datos de registro invalidos", issues: parsed.error.flatten() });
    try {
      const user = await registerUser(parsed.data.name, parsed.data.email, parsed.data.password);
      const token = await reply.jwtSign({ id: user.id, email: user.email, role: user.role }, { expiresIn: "7d" });
      return reply.code(201).send({ user, token });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ message: "El email ya esta registrado" });
      throw error;
    }
  });

  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: loginValidationMessage(parsed.error) });
    const user = await loginUser(parsed.data.email, parsed.data.password);
    if (!user) return reply.code(401).send({ message: "Email o contrasena incorrectos, o usuario inactivo" });
    const token = await reply.jwtSign({ id: user.id, email: user.email, role: user.role }, { expiresIn: "7d" });
    return { user, token };
  });

  app.get("/me", { preHandler: [authenticate] }, async (request, reply) => {
    const user = await getUserById(request.user.id);
    if (!user?.isActive) return reply.code(401).send({ message: "Usuario no disponible" });
    return { user };
  });
}
