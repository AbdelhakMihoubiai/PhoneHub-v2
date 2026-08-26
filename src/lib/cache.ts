/**
 * Requirement #10: configurable cache expiration per data category.
 */
const DEFAULTS: Record<string, number> = {
  specs: num("TTL_SPECS_HOURS", 168), // 7 days
  benchmark: num("TTL_BENCHMARK_HOURS", 168),
  price: num("TTL_PRICE_HOURS", 12),
  release: num("TTL_RELEASE_HOURS", 720), // 30 days
};

function num(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function ttlHours(category: keyof typeof DEFAULTS | string): number {
  return (DEFAULTS as Record<string, number>)[category] ?? DEFAULTS.specs;
}

export function isFresh(retrievedAt: string | null | undefined, category: string): boolean {
  if (!retrievedAt) return false;
  const ageMs = Date.now() - new Date(retrievedAt).getTime();
  return ageMs < ttlHours(category) * 3600_000;
}

export function categoryForField(fieldPath: string): string {
  if (fieldPath.startsWith("release.")) return "release";
  if (fieldPath.startsWith("price.")) return "price";
  if (fieldPath.startsWith("benchmark.")) return "benchmark";
  return "specs";
}

/** In-memory response cache to dedupe concurrent identical lookups. */
const inflight = new Map<string, Promise<unknown>>();
export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
