export interface User {
  id: string; name: string; email: string; role: "user" | "admin"; isActive: boolean;
  lastLoginAt: string | null; loginCount: number; createdAt: string;
}

export interface DbConfiguration {
  id: string; userId: string; name: string; engine: string;
  host?: string; port?: number; username?: string;
  database?: string; options?: Record<string, unknown>; hasPassword: boolean;
  hasDatabase?: boolean; createdAt: string; updatedAt: string; expiresAt: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem("token");
    throw new ApiError(typeof body === "string" ? body : body.message ?? "Error de solicitud", response.status);
  }
  return body as T;
}

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_URL}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    throw new ApiError(typeof body === "string" ? body : body.message ?? "No se pudo descargar el archivo", response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const link = document.createElement("a");
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function uploadDatabase(engine: string, file: File): Promise<{ database: string; originalName: string; size: number; tableCount: number }> {
  const form = new FormData();
  form.append("file", file);
  return api(`/configurations/database-upload/${engine}`, {
    method: "POST",
    body: form
  });
}
