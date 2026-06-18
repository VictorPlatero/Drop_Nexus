const DEFAULT_MAX_DATABASE_FILE_SIZE_MB = 500;

export function maxDatabaseFileSizeMb(): number {
  const configured = Number(process.env.MAX_DATABASE_FILE_SIZE_MB ?? DEFAULT_MAX_DATABASE_FILE_SIZE_MB);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_DATABASE_FILE_SIZE_MB;
}

export function maxDatabaseFileSizeBytes(): number {
  return Math.floor(maxDatabaseFileSizeMb() * 1024 * 1024);
}
