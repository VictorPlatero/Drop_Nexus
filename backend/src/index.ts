import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "./utils/logger.js";
import { initializeDatabase } from "./db/database.js";
import { seedAdmin } from "./seed/adminSeed.js";
import { registerRateLimit } from "./middleware/rateLimit.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { adminRoutes } from "./routes/admin.js";
import { maxDatabaseFileSizeBytes } from "./utils/uploadLimits.js";
import { resumePendingReplications } from "./services/replicationService.js";
import { configurationRoutes } from "./routes/configurations.js";
import { replicationRoutes } from "./routes/replication.js";
import { healthRoutes } from "./routes/health.js";
import { schemaRoutes } from "./routes/schema.js";
import { assistantRoutes } from "./routes/assistant.js";
import { cleanupExpiredConfigurations, startExpirationCleanup } from "./services/expirationService.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");

await app.register(helmet);
await app.register(cors, {
  origin: (process.env.FRONTEND_URL ?? "http://localhost:5173").split(","),
  credentials: true
});
await app.register(jwt, { secret: jwtSecret, sign: { expiresIn: "7d" } });
await app.register(multipart, {
  limits: { files: 1, fileSize: maxDatabaseFileSizeBytes() }
});
await registerRateLimit(app);

app.get("/api/status", async () => ({ status: "ok", timestamp: new Date().toISOString() }));
await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(userRoutes, { prefix: "/api/users" });
await app.register(adminRoutes, { prefix: "/api/admin" });
await app.register(configurationRoutes, { prefix: "/api/configurations" });
await app.register(replicationRoutes, { prefix: "/api/replications" });
await app.register(healthRoutes, { prefix: "/api/health" });
await app.register(schemaRoutes, { prefix: "/api/schema" });
await app.register(assistantRoutes, { prefix: "/api/assistant" });

const frontendRoot = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
if (existsSync(frontendRoot)) {
  await app.register(fastifyStatic, { root: frontendRoot, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ message: "Ruta no encontrada" });
    return reply.sendFile("index.html");
  });
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ error }, "Request failed");
  const knownError = error as Error & { statusCode?: number };
  const status = knownError.statusCode && knownError.statusCode < 500 ? knownError.statusCode : 500;
  return reply.code(status).send({ message: status === 500 ? "Error interno del servidor" : knownError.message });
});

await initializeDatabase();
await seedAdmin();
await resumePendingReplications();
await cleanupExpiredConfigurations();
startExpirationCleanup();

const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });
logger.info({ port }, "API listening");
