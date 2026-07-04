import type { FastifyRequest } from "fastify";

export const DB_ENGINES = ["postgresql", "mysql", "mariadb", "sqlserver", "oracle", "sqlite", "mongodb", "excel"] as const;
export type DbEngine = (typeof DB_ENGINES)[number];
export type UserRole = "user" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthUser;
}

export interface DbConfiguration {
  id: string;
  userId: string;
  name: string;
  engine: DbEngine;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  options?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ColumnSchema {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
  defaultValue?: string | null;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
}

export interface ConnectionTest {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ReplicationProgress {
  id: string;
  recordsCopied: number;
  status: "starting" | "running" | "stopped" | "completed" | "failed";
  lagSeconds: number;
  error?: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}
