import type { Confidence, FieldValue, ProviderResult } from "@/lib/types";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalize a user query into brand/model tokens for matching. */
export function normalizeQuery(q: string): { text: string; brand?: string } {
  const text = q.trim().replace(/\s+/g, " ");
  const known = [
    "apple", "iphone", "samsung", "galaxy", "xiaomi", "redmi", "poco",
    "oneplus", "google", "pixel", "oppo", "vivo", "realme", "motorola",
    "nothing", "honor", "huawei", "sony", "asus", "rog", "nokia", "tecno",
    "infinix", "iqoo", "lenovo", "fairphone", "zenfone",
  ];
  const lower = text.toLowerCase();
  const brand = known.find((b) => lower.includes(b));
  return { text, brand };
}

export interface RawField {
  value: unknown;
  unit?: string;
  status: Confidence;
  source: string;
  sourceUrl?: string;
  note?: string;
}

export function f(field: string, raw: RawField): Record<string, Omit<FieldValue, "field">> {
  return {
    [field]: {
      value: raw.value ?? null,
      unit: raw.unit,
      status: raw.value == null ? "unavailable" : raw.status,
      source: raw.source,
      sourceUrl: raw.sourceUrl,
      note: raw.note,
    },
  };
}

export function emptyResult(provider: string): ProviderResult {
  return {
    provider,
    fields: {},
    benchmarks: [],
    gaming: [],
    prices: [],
    variants: [],
    media: [],
    confirmed: false,
  };
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heuristic numeric extraction from free text, used ONLY by the web research
 * layer, always tagged `estimated` or `multiple_sources` — never `official`.
 */
export function extractNumber(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1].replace(/[, ]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
