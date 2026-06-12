import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("ENCRYPTION_KEY is required");
  if (/^[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value, "hex");
  return crypto.createHash("sha256").update(value).digest();
}

export function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decrypt(value?: string | null): string | undefined {
  if (!value) return undefined;
  const [ivPart, tagPart, encryptedPart] = value.split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Invalid encrypted value");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final()
  ]).toString("utf8");
}
