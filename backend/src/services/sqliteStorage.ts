import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { MultipartFile } from "@fastify/multipart";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const MAX_SQLITE_FILE_SIZE = 100 * 1024 * 1024;

export function sqliteUploadRoot(): string {
  return path.resolve(process.env.SQLITE_UPLOAD_DIR ?? path.join(process.cwd(), "storage", "sqlite"));
}

function userDirectory(userId: string): string {
  return path.join(sqliteUploadRoot(), String(userId));
}

export function isOwnedSQLitePath(filePath: string, userId: string): boolean {
  const resolved = path.resolve(filePath);
  const directory = `${path.resolve(userDirectory(userId))}${path.sep}`;
  return resolved.startsWith(directory);
}

export async function storeSQLiteUpload(file: MultipartFile, userId: string): Promise<{ path: string; originalName: string; size: number }> {
  const extension = path.extname(file.filename).toLowerCase();
  if (![".db", ".sqlite", ".sqlite3"].includes(extension)) {
    throw new Error("Solo se permiten archivos .db, .sqlite o .sqlite3");
  }

  const directory = userDirectory(userId);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${randomUUID()}${extension}`);
  let size = 0;

  file.file.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_SQLITE_FILE_SIZE) file.file.destroy(new Error("El archivo SQLite supera el límite de 100 MB"));
  });

  try {
    await pipeline(file.file, createWriteStream(destination, { flags: "wx" }));
    const handle = await open(destination, "r");
    try {
      const header = Buffer.alloc(SQLITE_HEADER.length);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) {
        throw new Error("El archivo no contiene una base de datos SQLite válida");
      }
    } finally {
      await handle.close();
    }
    return { path: destination, originalName: path.basename(file.filename), size };
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeOwnedSQLiteFile(filePath: string | undefined, userId: string): Promise<void> {
  if (!filePath || !isOwnedSQLitePath(filePath, userId)) return;
  await rm(filePath, { force: true }).catch(() => undefined);
}

export async function verifyStoredSQLiteFile(filePath: string, userId: string): Promise<void> {
  if (!isOwnedSQLitePath(filePath, userId)) throw new Error("Archivo SQLite no autorizado");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { start: 0, end: SQLITE_HEADER.length - 1 });
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => Buffer.concat(chunks).equals(SQLITE_HEADER) ? resolve() : reject(new Error("Archivo SQLite inválido")));
  });
}
