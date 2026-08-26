/**
 * Universal phone data model.
 *
 * Requirement #15: extensible schema — every spec is a field path on a
 * nested record, so new technologies (satellite connectivity, foldables,
 * new charging standards...) are just new paths, never migrations.
 *
 * Requirement #4/#5: every retrieved value carries source metadata and a
 * confidence status.
 */

export type Confidence =
  | "official"
  | "verified"
  | "multiple_sources"
  | "estimated"
  | "user_submitted"
  | "unavailable";

export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  official: 5,
  verified: 4,
  multiple_sources: 3,
  estimated: 2,
  user_submitted: 1,
  unavailable: 0,
};

/** A single sourced field value. */
export interface FieldValue<T = unknown> {
  field: string; // dot path e.g. "battery.capacity"
  value: T | null;
  unit?: string;
  status: Confidence;
  source?: string; // human-readable source name
  sourceUrl?: string;
  retrievedAt?: string; // ISO date
  note?: string; // e.g. "AI analysis", "Estimated from chipset class"
}

export interface BenchmarkEntry {
  name: string; // AnTuTu v10, Geekbench 6 Single...
  version?: string;
  score: number | null;
  configJson?: string; // device configuration / test conditions
  testDate?: string;
  status: Confidence;
  source?: string;
  sourceUrl?: string;
  retrievedAt?: string;
}

export interface GamingResult {
  game: string; // Genshin Impact, PUBG Mobile...
  avgFps: number | null;
  minFps?: number | null;
  maxFps?: number | null;
  settings?: string; // graphics preset
  resolution?: string;
  temperatureC?: number | null;
  batteryDrain?: string;
  durationMin?: number | null;
  status: Confidence;
  source?: string;
  sourceUrl?: string;
  retrievedAt?: string;
}

export interface PriceEntry {
  variant: string; // "12GB / 256GB"
  price: number | null;
  currency?: string;
  country?: string;
  retailer?: string;
  url?: string;
  retrievedAt?: string;
  status: Confidence;
}

export interface PhoneVariant {
  id?: number;
  ramGb?: number | null;
  storageGb?: number | null;
  colors?: string[];
  modelNumber?: string | null;
  region?: string | null;
}

/** Related media captured from live sources (news, reviews, gallery shots, 3D). */
export interface MediaEntry {
  kind: "news" | "review" | "gallery" | "model3d";
  title: string;
  url?: string;
  imageUrl?: string;
}

export interface Suggestion {
  name: string;
  brand: string;
  gsmSlug: string; // m.gsmarena.com style slug with id
  image?: string;
}

/**
 * A phone profile is a flat map of sourced fields plus collections.
 * The nested display form is derived via buildNested().
 */
export interface PhoneRecord {
  id: number;
  slug: string;
  brand: string;
  model: string;
  aliases: string[];
  imageUrl: string | null;
  releaseDate: string | null;
  createdAt: string;
  updatedAt: string;
  fields: Record<string, FieldValue>;
  variants: PhoneVariant[];
}

export interface ProviderResult {
  provider: string;
  /** Normalized field values keyed by dot path. */
  fields: Record<string, Omit<FieldValue, "field">>;
  benchmarks: Partial<BenchmarkEntry>[];
  gaming: Partial<GamingResult>[];
  prices: Partial<PriceEntry>[];
  variants: PhoneVariant[];
  media?: MediaEntry[];
  brand?: string;
  model?: string;
  aliases?: string[];
  imageUrl?: string | null;
  releaseDate?: string | null;
  /** Canonical page for the device, if any. */
  canonicalUrl?: string;
  /**
   * True when this provider verified the device's identity (title/entity
   * guards), e.g. curated articles, structured open data, spec APIs.
   * Raw web research sets false — its matches are heuristic.
   */
  confirmed?: boolean;
  errors?: string[];
}

export interface PhoneDataProvider {
  readonly key: string;
  readonly label: string;
  readonly priority: number; // lower = tried first
  /** Whether the provider has required configuration (API keys etc). */
  isConfigured(): boolean;
  /** Look up a phone by free-text query. Returns null if not found there. */
  search(query: string): Promise<ProviderResult | null>;
  fetchRobotsOk?(url: string): Promise<boolean>;
}
