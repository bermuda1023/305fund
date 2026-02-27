export type DbRuntimeMode = 'sqlite-bridge' | 'postgres-primary';

function normalizeBool(value: string | undefined, fallback = false): boolean {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

export function getDbRuntimeMode(): DbRuntimeMode {
  const raw = String(process.env.DB_RUNTIME_MODE || '').trim().toLowerCase();
  return raw === 'postgres-primary' ? 'postgres-primary' : 'sqlite-bridge';
}

export function isPostgresPrimaryMode(): boolean {
  return getDbRuntimeMode() === 'postgres-primary';
}

export function usePostgresLpRoutes(): boolean {
  return normalizeBool(process.env.USE_POSTGRES_LP, isPostgresPrimaryMode());
}

export function usePostgresActualsRoutes(): boolean {
  return normalizeBool(process.env.USE_POSTGRES_ACTUALS, isPostgresPrimaryMode());
}

export function usePostgresReads(): boolean {
  return normalizeBool(process.env.USE_POSTGRES_READ, isPostgresPrimaryMode());
}

export function dualWriteEnabled(): boolean {
  return normalizeBool(process.env.DUAL_WRITE_ENABLED, false);
}

export function sqliteFallbackEnabled(): boolean {
  return normalizeBool(process.env.SQLITE_FALLBACK_ENABLED, true);
}

