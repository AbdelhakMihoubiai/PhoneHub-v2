/**
 * Requirement #13: legal & robot compliance helpers.
 * - Per-provider token-bucket rate limiting
 * - robots.txt checking with caching (for web research fetches)
 */

const buckets = new Map<string, number[]>();

export function rateLimitAllow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= Math.max(1, perMinute)) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

const robotsCache = new Map<string, { disallow: string[]; fetchedAt: number }>();
const ROBOTS_TTL_MS = 6 * 3600_000;

export async function isUrlAllowedByRobots(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const base = `${u.protocol}//${u.host}`;
    let entry = robotsCache.get(base);
    if (!entry || Date.now() - entry.fetchedAt > ROBOTS_TTL_MS) {
      const res = await fetch(`${base}/robots.txt`, {
        headers: { "User-Agent": "PhoneInfoHub/1.0 (+research; respectful)" },
        signal: AbortSignal.timeout(8000),
      });
      const text = res.ok ? await res.text() : "";
      const disallow: string[] = [];
      let appliesToUs = false;
      for (const line of text.split(/\r?\n/)) {
        const clean = line.split("#")[0].trim();
        if (/^user-agent:/i.test(clean)) {
          appliesToUs = /\*/i.test(clean.split(":")[1]?.trim() ?? "");
        } else if (appliesToUs && /^disallow:/i.test(clean)) {
          const p = clean.slice("disallow:".length).trim();
          if (p) disallow.push(p);
        }
      }
      entry = { disallow, fetchedAt: Date.now() };
      robotsCache.set(base, entry);
    }
    return !entry.disallow.some((p) => u.pathname.startsWith(p));
  } catch {
    // If robots.txt cannot be retrieved, fail closed for unknown hosts.
    return false;
  }
}

const UA = "PhoneInfoHub/1.0 (public-data research; contact: admin@localhost)";

export async function politeFetch(
  url: string,
  opts: {
    rateKey?: string;
    perMinute?: number;
    timeoutMs?: number;
    accept?: string;
    /**
     * Skip the robots.txt check for documented machine APIs whose operators
     * state robots.txt does not govern them (e.g. the MediaWiki Action API,
     * which is explicitly provided for programmatic access by the Wikimedia
     * Foundation). Never use this for ordinary page scraping.
     */
    apiExempt?: boolean;
    /** Override the User-Agent when a source requires a browser-like client. */
    ua?: string;
  } = {}
): Promise<Response | null> {
  const { rateKey = url, perMinute = 20, timeoutMs = 12000 } = opts;
  if (!rateLimitAllow(rateKey, perMinute)) return null;
  if (!opts.apiExempt && !(await isUrlAllowedByRobots(url))) return null;
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": opts.ua ?? UA,
        Accept: opts.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
  } catch {
    return null;
  }
}
