import type { PhoneDataProvider, ProviderResult } from "@/lib/types";
import { emptyResult, f, stripTags } from "./base";
import { politeFetch } from "@/lib/fetch-compliance";

/**
 * Requirement #3/#13: server-side web research fallback.
 * Uses the DuckDuckGo HTML endpoint (public, no key) to find pages, then
 * politely fetches robots-permitted pages and extracts specifications with
 * conservative heuristics. Everything from this provider is tagged
 * `estimated` (single page) or `multiple_sources` — never `official`.
 * Missing data is returned as absent; callers render "Not available".
 */

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

async function ddgSearch(query: string): Promise<Hit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await politeFetch(url, { rateKey: "ddg", perMinute: 10, timeoutMs: 6000 });
  if (!res?.ok) return [];
  const html = await res.text();
  const hits: Hit[] = [];
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 8) {
    let href = m[1];
    if (href.startsWith("//duckduckgo.com/l/?uddg=")) {
      try {
        href = decodeURIComponent(new URL("https:" + href).searchParams.get("uddg") ?? "");
      } catch {
        continue;
      }
    }
    if (!/^https?:\/\//.test(href)) continue;
    hits.push({
      url: href,
      title: stripTags(m[2]),
      snippet: m[3] ? stripTags(m[3]) : "",
    });
  }
  return hits;
}

/** Bing web results (robots.txt permits /search for generic agents). */
async function bingSearch(query: string): Promise<Hit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
  const res = await politeFetch(url, { rateKey: "bing", perMinute: 10, timeoutMs: 15000 });
  if (!res?.ok) return [];
  const html = await res.text();
  const hits: Hit[] = [];
  const re =
    /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 8) {
    const target = decodeBingRedirect(m[1]);
    if (!target) continue;
    hits.push({ url: target, title: stripTags(m[2]), snippet: stripTags(m[3]).slice(0, 300) });
  }
  return hits;
}

/** Bing wraps results in /ck/a redirects with a base64url `u=a1…` parameter. */
function decodeBingRedirect(href: string): string | null {
  const clean = href.replace(/&amp;/g, "&");
  if (!clean.includes("bing.com/ck/")) {
    return /^https?:\/\//.test(clean) ? clean : null;
  }
  try {
    const u = new URL(clean).searchParams.get("u");
    if (!u) return null;
    const b64 = u.replace(/^a1/, "").replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    return /^https?:\/\//.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function webSearch(query: string): Promise<Hit[]> {
  // DuckDuckGo first; Bing fallback (some networks block one of them).
  const ddg = await ddgSearch(query).catch(() => []);
  if (ddg.length > 0) return ddg;
  return bingSearch(query).catch(() => []);
}

/** Spec extraction patterns. Each match is a heuristic → low confidence. */
const SPEC_PATTERNS: Array<{ field: string; unit?: string; kind?: "number" | "string"; patterns: RegExp[] }> = [
  { field: "battery.capacity", unit: "mAh", kind: "number", patterns: [/(\d{3,4}(?:\.\d)?)\s*mAh/i] },
  { field: "display.sizeInches", unit: "in", kind: "number", patterns: [/(\d{1,2}\.\d{1,2})\s*(?:-?inch|")/i] },
  { field: "display.resolution", kind: "string", patterns: [/\b(\d{3,4}\s?[x×]\s?\d{3,4})\s*pixels?\b/i] },
  { field: "memory.ram", unit: "GB", kind: "number", patterns: [/\b(\d{1,2})\s*GB\s*(?:of\s*)?RAM\b/i] },
  { field: "body.weight", unit: "g", kind: "number", patterns: [/(\d{2,3}(?:\.\d)?)\s*g(?:rams)?\b/i] },
  { field: "camera.main", unit: "MP", kind: "number", patterns: [/\b(\d{2,3})(?:\.\d)?\s*MP\b/i] },
  { field: "performance.chipset", kind: "string", patterns: [/(Snapdragon\s+(?:8|7|6|4)\s?(?:Gen\s?\d|Elite|\d{1,3})\w*)/i, /(Apple\s+A\d{1,2}\s?(?:Pro|Max|Ultra)?)/i, /(Dimensity\s\d{3,4}\w*)/i, /(Exynos\s\d{3,4}\w*)/i, /(Tensor\sG\d)/i, /(Helio\sG\d{2}\w*)/i, /(Kirin\s\d{3,4}\w*)/i] },
  { field: "release.date", kind: "string", patterns: [/Released\s+(\d{4},\s+[A-Z][a-z]+\s+\d{1,2})/i] },
];

function voteValue(spec: { kind?: "number" | "string"; patterns: RegExp[] }, text: string): string | null {
  for (const re of spec.patterns) {
    const m = text.match(re);
    if (!m) continue;
    if (spec.kind === "string") return m[1].replace(/[\s"'”]+/g, " ").trim();
    const n = Number(m[1].replace(/[, ]/g, ""));
    if (Number.isFinite(n)) return String(n);
  }
  return null;
}

export class WebSearchProvider implements PhoneDataProvider {
  readonly key = "web_search";
  readonly label = "Web research (DuckDuckGo + public spec pages)";
  readonly priority = 90;

  isConfigured() {
    return process.env.WEB_RESEARCH_ENABLED !== "false";
  }

  /**
   * Identity guard (requirement #12): a page may only contribute specs if it
   * is actually about THIS device.
   *  1. Every query token must occur (word-bounded) on the page.
   *  2. Every model-number token ("7a", "s26") must sit within ≤2 words of a
   *     brand/series word ("pixel 7a", "galaxy s26 ultra").
   * This makes cross-device contamination ("iPhone 30" ← iPhone 17 pages)
   * effectively impossible while allowing normal product pages through.
   */
  private identityOk(query: string, url: string, text: string): boolean {
    const hay = `${url.replace(/[-_./]/g, " ")} ${text.slice(0, 12_000)}`.toLowerCase();
    const tokens = query.toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length >= 2) ?? [];
    const stop = new Set(["google", "samsung", "phone", "smartphone", "mobile"]);
    const req = tokens.filter((t) => !stop.has(t));
    if (req.length === 0) return false;
    const digits = req.filter((t) => /\d/.test(t));
    const words = req.filter((t) => !/\d/.test(t));
    const bounded = (t: string) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);

    // 1) presence of every token
    if (!req.every((t) => bounded(t).test(hay))) return false;
    if (digits.length === 0) return true;

    // 2) model numbers adjacent to brand/series context
    return digits.every((dt) => {
      const nearBrand = words.some(
        (w) =>
          new RegExp(`${w}[\\s_-]*(?:[a-z0-9]+[\\s_-]*){0,2}${dt}|${dt}(?:[\\s_-]*[a-z0-9]+){0,2}[\\s_-]*${w}`).test(hay)
      );
      const attached = new RegExp(`[a-z]{2,}[\\s_-]*${dt}`).test(hay); // e.g. "pixel_7a"
      return nearBrand || attached;
    });
  }

  async search(query: string): Promise<ProviderResult | null> {
    const maxPages = Number(process.env.WEB_RESEARCH_MAX_PAGES ?? 3);
    const vendor = guessVendorDomain(query);
    const officialQuery =
      vendor === "gsmarena.com" ? `${query} specifications` : `${query} specifications site:${vendor}`;
    const officialHits = await webSearch(officialQuery).catch(() => []);
    const generalHits = await webSearch(`${query} full phone specifications`).catch(() => []);

    const seen = new Set<string>();
    const ordered = [...officialHits, ...generalHits].filter((h) => {
      if (seen.has(h.url)) return false;
      seen.add(h.url);
      return true;
    }).slice(0, maxPages);
    if (ordered.length === 0) return null;

    const out = emptyResult(this.key);
    out.canonicalUrl = ordered[0]?.url;
    out.model = query;

    // Aggregate votes across pages: agreement of ≥2 independent sources
    // upgrades confidence to multiple_sources (never official).
    const votes = new Map<string, Map<string, number>>();
    for (const hit of ordered) {
      const res = await politeFetch(hit.url, { rateKey: `web:${new URL(hit.url).host}`, perMinute: 10, timeoutMs: 10000 });
      if (!res?.ok) continue;
      const text = stripTags(await res.text()).slice(0, 200_000);
      if (!this.identityOk(query, hit.url, text)) continue;

      for (const spec of SPEC_PATTERNS) {
        const v = voteValue(spec, text);
        if (v == null) continue;
        const byVal = votes.get(spec.field) ?? new Map();
        byVal.set(v, (byVal.get(v) ?? 0) + 1);
        votes.set(spec.field, byVal);
      }
    }

    for (const spec of SPEC_PATTERNS) {
      const byVal = votes.get(spec.field);
      if (!byVal || byVal.size === 0) continue;
      const [bestVal, count] = [...byVal.entries()].sort((a, b) => b[1] - a[1])[0];
      Object.assign(
        out.fields,
        f(spec.field, {
          value: spec.kind === "string" ? bestVal : Number(bestVal),
          unit: spec.unit,
          status: count >= 2 ? "multiple_sources" : "estimated",
          source: "Web research",
          sourceUrl: out.canonicalUrl,
          note: count >= 2 ? `${count} independent pages agree` : "Single public page — verify before relying on it",
        })
      );
    }

    return Object.keys(out.fields).length > 0 ? out : null;
  }
}

function guessVendorDomain(query: string): string {
  const q = query.toLowerCase();
  if (/iphone|apple/.test(q)) return "apple.com";
  if (/galaxy|samsung/.test(q)) return "samsung.com";
  if (/pixel/.test(q)) return "store.google.com";
  if (/xiaomi|redmi|poco/.test(q)) return "mi.com";
  if (/oneplus/.test(q)) return "oneplus.com";
  if (/nothing/.test(q)) return "nothing.tech";
  return "gsmarena.com";
}
