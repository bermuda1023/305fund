export function parseNumberInput(value: string): number {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatNumberInput(
  value: number | string | null | undefined,
  options?: { maxFractionDigits?: number }
): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).replace(/,/g, '').trim();
  if (!raw) return '';
  if (raw === '-' || raw === '.' || raw === '-.') return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  const maxFractionDigits = options?.maxFractionDigits ?? 0;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0,
  }).format(n);
}
