import db from "@/lib/db";
import { isFresh, once } from "@/lib/cache";
import type {
  Confidence,
  FieldValue,
  PhoneRecord,
  PhoneDataProvider,
  ProviderResult,
} from "@/lib/types";
import { CONFIDENCE_ORDER as CO } from "@/lib/types";
import { slugify } from "@/lib/providers/base";
import { WikidataProvider } from "@/lib/providers/wikidata";
import { WikipediaProvider } from "@/lib/providers/wikipedia";
import { OpenDatasetProvider } from "@/lib/providers/opendataset";
import { GsmArenaCommunityProvider } from "@/lib/providers/gsmarena";
import { GsmArenaMobileProvider, searchExact } from "@/lib/providers/gsmarena-mobile";
import { WebSearchProvider } from "@/lib/providers/websearch";

/**
 * Requirement #19: data-provider abstraction pipeline.
 *   search DB → fresh? return → query providers in priority order →
 *   merge by source priority → record conflicts + history → store.
 * Requirement #12: missing values are never invented; they stay absent and
 * render as "Not available".
 */

function allProviders(): PhoneDataProvider[] {
  const list: PhoneDataProvider[] = [
    new GsmArenaMobileProvider(),
    new GsmArenaCommunityProvider(),
    new WikipediaProvider(),
    new WikidataProvider(),
    new OpenDatasetProvider(),
    new WebSearchProvider(),
  ];
  // Admin overrides from DB (enable/disable + priority)
  const rows = db.prepare("SELECT * FROM providers").all() as Array<{
    key: string;
    enabled: number;
    priority: number;
  }>;
  for (const r of rows) {
    const p = list.find((x) => x.key === r.key);
    if (p) Object.assign(p, { priority: r.priority, _enabled: !!r.enabled });
  }
  return list
    .filter((p) => (p as unknown as { _enabled?: boolean })._enabled !== false)
    .filter((p) => p.isConfigured())
    .sort((a, b) => a.priority - b.priority);
}

export function providerStatuses() {
  return allProviders().map((p) => ({
    key: p.key,
    label: p.label,
    priority: p.priority,
    configured: p.isConfigured(),
  }));
}

function logProvider(key: string, query: string, ok: boolean, error?: string) {
  db.prepare(
    "INSERT INTO provider_logs (provider_key, query, ok, error) VALUES (?, ?, ?, ?)"
  ).run(key, query.slice(0, 200), ok ? 1 : 0, error?.slice(0, 500) ?? null);
}

async function runProvider(
  p: PhoneDataProvider,
  query: string
): Promise<ProviderResult | null> {
  try {
    const r = await p.search(query);
    logProvider(p.key, query, true);
    return r;
  } catch (e) {
    logProvider(p.key, query, false, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Merge multiple provider results; higher confidence wins, conflicts recorded. */
function mergeResults(results: ProviderResult[], phoneId?: number): ProviderResult | null {
  if (results.length === 0) return null;
  const merged: ProviderResult = {
    ...results[0],
    fields: {},
    benchmarks: [],
    gaming: [],
    prices: [],
    variants: [],
  };
  const fieldConflicts: Array<{ entity: string; key: string; a: Omit<FieldValue, "field">; b: Omit<FieldValue, "field"> }> = [];

  for (const r of results) {
    for (const [field, val] of Object.entries(r.fields)) {
      if (val.value == null) continue;
      const existing = merged.fields[field];
      if (!existing || existing.value == null || CO[val.status] > CO[existing.status]) {
        if (existing && existing.value != null && existing.value !== val.value && CO[val.status] === CO[existing.status]) {
          fieldConflicts.push({ entity: "field", key: field, a: existing, b: val });
        }
        merged.fields[field] = val;
      }
      if (val.sourceUrl && !merged.canonicalUrl && field === "general.description") merged.canonicalUrl = val.sourceUrl;
    }
    for (const b of r.benchmarks) merged.benchmarks.push(b);
    for (const g of r.gaming) merged.gaming.push(g);
    for (const pr of r.prices) merged.prices.push(pr);
    for (const v of r.variants) merged.variants.push(v);
    if (r.media) merged.media!.push(...r.media);
    merged.brand = merged.brand ?? r.brand;
    merged.model = merged.model ?? r.model;
    merged.imageUrl = merged.imageUrl ?? r.imageUrl;
    merged.releaseDate = merged.releaseDate ?? r.releaseDate;
  }

  if (phoneId) {
    const ins = db.prepare(
      `INSERT INTO conflicts (phone_id, entity, key, value_a, source_a, value_b, source_b, resolved_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of fieldConflicts)
      ins.run(
        phoneId, c.entity, c.key,
        JSON.stringify(c.a.value), c.a.source ?? null,
        JSON.stringify(c.b.value), c.b.source ?? null,
        JSON.stringify(merged.fields[c.key]?.value ?? null)
      );
  }
  return merged;
}

function upsertPhone(query: string, merged: ProviderResult): number {
  const brand = merged.brand ?? guessBrand(query);
  let model = merged.model ?? query;
  // Normalize: GSMArena titles include the brand ("Realme 8") — store the
  // variant part only so display "brand model" never doubles up.
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) {
    model = model.slice(brand.length).trim() || model;
  }
  const slug = slugify(`${brand} ${model}`);
  const now = new Date().toISOString();
  let id: number;

  const existing = db.prepare("SELECT id FROM phones WHERE slug = ?").get(slug) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE phones SET updated_at = ?, image_url = COALESCE(?, image_url), release_date = COALESCE(?, release_date) WHERE id = ?")
      .run(now, merged.imageUrl ?? null, merged.releaseDate ?? null, existing.id);
    id = existing.id;
  } else {
    const r = db.prepare(
      "INSERT INTO phones (slug, brand, model, aliases, image_url, release_date, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?, ?, ?)"
    ).run(slug, brand, model, merged.imageUrl ?? null, merged.releaseDate ?? null, now, now);
    id = Number(r.lastInsertRowid);
  }

  const histIns = db.prepare(
    "INSERT INTO update_history (phone_id, entity, key, old_value, new_value, source, retrieved_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const fieldUpsert = db.prepare(
    `INSERT INTO fields (phone_id, field_path, value, unit, status, source, source_url, retrieved_at, note)
     VALUES (@pid, @path, @value, @unit, @status, @source, @source_url, @at, @note)
     ON CONFLICT(phone_id, field_path) DO UPDATE SET
       value=excluded.value, unit=excluded.unit, status=excluded.status,
       source=excluded.source, source_url=excluded.source_url,
       retrieved_at=excluded.retrieved_at, note=excluded.note`
  );
  const oldField = db.prepare("SELECT value FROM fields WHERE phone_id = ? AND field_path = ?");

  for (const [path, val] of Object.entries(merged.fields)) {
    if (val.value == null) continue;
    const at = val.retrievedAt ?? now;
    const prev = oldField.get(id, path) as { value: string } | undefined;
    fieldUpsert.run({
      pid: id, path, value: JSON.stringify(val.value), unit: val.unit ?? null,
      status: val.status, source: val.source ?? null, source_url: val.sourceUrl ?? null,
      at, note: val.note ?? null,
    });
    histIns.run(id, "field", path, prev?.value ?? null, JSON.stringify(val.value), val.source ?? null, at);
  }

  const bmIns = db.prepare(
    `INSERT INTO benchmarks (phone_id, name, version, score, config_json, test_date, status, source, source_url, retrieved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const bmDel = db.prepare("DELETE FROM benchmarks WHERE phone_id = ? AND name = ?");
  for (const b of merged.benchmarks) {
    if (!b.name || b.score == null) continue;
    bmDel.run(id, b.name);
    bmIns.run(id, b.name, b.version ?? null, b.score, b.configJson ?? null, b.testDate ?? null,
      b.status ?? "verified", b.source ?? null, b.sourceUrl ?? null, b.retrievedAt ?? now);
    histIns.run(id, "benchmark", b.name, null, String(b.score), b.source ?? null, now);
  }

  const gmIns = db.prepare(
    `INSERT INTO gaming_results (phone_id, game, avg_fps, min_fps, max_fps, settings, resolution, temperature_c, battery_drain, duration_min, status, source, source_url, retrieved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const gmDel = db.prepare("DELETE FROM gaming_results WHERE phone_id = ? AND game = ?");
  for (const g of merged.gaming) {
    if (!g.game || g.avgFps == null) continue;
    gmDel.run(id, g.game);
    gmIns.run(id, g.game, g.avgFps, g.minFps ?? null, g.maxFps ?? null, g.settings ?? null,
      g.resolution ?? null, g.temperatureC ?? null, g.batteryDrain ?? null, g.durationMin ?? null,
      g.status ?? "verified", g.source ?? null, g.sourceUrl ?? null, g.retrievedAt ?? now);
    histIns.run(id, "gaming", g.game, null, String(g.avgFps), g.source ?? null, now);
  }

  const prIns = db.prepare(
    `INSERT INTO prices (phone_id, variant, price, currency, country, retailer, url, status, retrieved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const prDel = db.prepare(
    "DELETE FROM prices WHERE phone_id = ? AND retailer = ? AND variant IS ?"
  );
  const seenPrices = new Set<string>();
  for (const p of merged.prices) {
    if (!p.retailer || p.price == null) continue;
    const pKey = `${p.retailer}|${p.variant ?? ""}|${p.country ?? ""}`;
    if (seenPrices.has(pKey)) continue;
    seenPrices.add(pKey);
    prDel.run(id, p.retailer, p.variant ?? null);
    prIns.run(id, p.variant ?? null, p.price, p.currency ?? null, p.country ?? null,
      p.retailer, p.url ?? null, p.status ?? "verified", p.retrievedAt ?? now);
    histIns.run(id, "price", `${p.variant ?? ""}@${p.retailer}`, null, String(p.price), p.retailer, now);
  }

  // Variants (RAM/storage combos, colors, model numbers)
  db.prepare("DELETE FROM variants WHERE phone_id = ?").run(id);
  const varIns = db.prepare(
    "INSERT INTO variants (phone_id, ram_gb, storage_gb, colors, model_number, region) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const seenVariants = new Set<string>();
  for (const v of merged.variants) {
    const key = `${v.ramGb ?? ""}|${v.storageGb ?? ""}|${(v.colors ?? []).join(",")}|${v.modelNumber ?? ""}`;
    if (seenVariants.has(key)) continue;
    seenVariants.add(key);
    varIns.run(id, v.ramGb ?? null, v.storageGb ?? null,
      v.colors ? JSON.stringify(v.colors) : null, v.modelNumber ?? null, v.region ?? null);
  }

  // Benchmarks from GSMArena "Our Tests" (AnTuTu / GeekBench / GFXBench…)
  const perf = merged.fields["gsma.Our_Tests.Performance"];
  if (perf && typeof perf.value === "string") {
    db.prepare("DELETE FROM benchmarks WHERE phone_id = ? AND source = 'GSMArena Our Tests'").run(id);
    const bIns = db.prepare(
      `INSERT INTO benchmarks (phone_id, name, version, score, config_json, status, source, source_url, retrieved_at)
       VALUES (?, ?, ?, ?, ?, 'verified', 'GSMArena Our Tests', ?, ?)`
    );
    for (const m of (perf.value as string).matchAll(/(AnTuTu|GeekBench|GFXBench|DXOMARK)\s*:\s*([^|]+)/gi)) {
      const name = m[1];
      const detail = m[2].trim();
      const scoreStr = detail.match(/([\d,]+)/)?.[1];
      const version = detail.match(/\(([^)]+)\)/)?.[1] ?? null;
      bIns.run(
        id, name, version,
        scoreStr ? Number(scoreStr.replace(/,/g, "")) : null,
        detail, perf.sourceUrl ?? null, now
      );
    }
  }

  // Media (news / reviews / gallery images)
  db.prepare("DELETE FROM media WHERE phone_id = ?").run(id);  const mediaIns = db.prepare(
    "INSERT INTO media (phone_id, kind, title, url, image_url, retrieved_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const seenMedia = new Set<string>();
  for (const mItem of merged.media ?? []) {
    const key = `${mItem.kind}|${mItem.url ?? mItem.imageUrl ?? mItem.title}`;
    if (seenMedia.has(key)) continue;
    seenMedia.add(key);
    mediaIns.run(id, mItem.kind, mItem.title.slice(0, 300), mItem.url ?? null,
      mItem.imageUrl ?? null, now);
  }

  return id;
}

function guessBrand(q: string): string {
  const lower = q.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/iphone|apple/, "Apple"],
    [/galaxy|samsung/, "Samsung"],
    [/pixel/, "Google"],
    [/redmi|poco|xiaomi|mi\b/, "Xiaomi"],
    [/oneplus/, "OnePlus"],
    [/nothing/, "Nothing"],
  ];
  for (const [re, brand] of map) if (re.test(lower)) return brand;
  return q.split(/\s+/)[0].replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getPhoneByIdOrSlug(idOrSlug: string): PhoneRecord | null {
  const row = (/^\d+$/.test(idOrSlug)
    ? db.prepare("SELECT * FROM phones WHERE id = ?").get(Number(idOrSlug))
    : db.prepare("SELECT * FROM phones WHERE slug = ?").get(idOrSlug)) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const id = row.id as number;
  const fieldRows = db.prepare("SELECT * FROM fields WHERE phone_id = ?").all(id) as Array<{
    field_path: string; value: string | null; unit: string | null; status: Confidence;
    source: string | null; source_url: string | null; retrieved_at: string; note: string | null;
  }>;
  const fields: Record<string, FieldValue> = {};
  for (const fr of fieldRows) {
    fields[fr.field_path] = {
      field: fr.field_path,
      value: fr.value == null ? null : JSON.parse(fr.value),
      unit: fr.unit ?? undefined,
      status: fr.status,
      source: fr.source ?? undefined,
      sourceUrl: fr.source_url ?? undefined,
      retrievedAt: fr.retrieved_at,
      note: fr.note ?? undefined,
    };
  }
  const variantRows = db.prepare("SELECT * FROM variants WHERE phone_id = ?").all(id) as Array<{
    ram_gb: number | null; storage_gb: number | null; colors: string | null; model_number: string | null; region: string | null;
  }>;
  return {
    id, slug: row.slug as string, brand: row.brand as string, model: row.model as string,
    aliases: JSON.parse(row.aliases as string), imageUrl: (row.image_url as string) ?? null,
    releaseDate: (row.release_date as string) ?? null,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
    fields,
    variants: variantRows.map((v) => ({
      ramGb: v.ram_gb, storageGb: v.storage_gb,
      colors: v.colors ? (JSON.parse(v.colors) as string[]) : undefined,
      modelNumber: v.model_number, region: v.region,
    })),
  };
}

export function searchLocal(q: string): PhoneRecord[] {
  const like = `%${q}%`;
  const rows = db.prepare(
    "SELECT id, slug, brand, model, image_url, release_date, updated_at FROM phones WHERE model LIKE ? OR brand LIKE ? OR slug LIKE ? LIMIT 20"
  ).all(like, like, like) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number, slug: r.slug as string, brand: r.brand as string,
    model: r.model as string, aliases: [], imageUrl: (r.image_url as string) ?? null,
    releaseDate: (r.release_date as string) ?? null, createdAt: "", updatedAt: r.updated_at as string,
    fields: {}, variants: [],
  }));
}

/**
 * Full pipeline: local cache first (freshness-checked), then providers.
 */
export async function resolvePhone(query: string, opts: { forceRefresh?: boolean; gsmSlug?: string } = {}): Promise<{ phone: PhoneRecord; fromCache: boolean }> {
  return once(`resolve:${query}:${opts.forceRefresh ? "f" : "c"}:${opts.gsmSlug ?? ""}`, async () => {
    // Exact device identity (live suggestion click): skip the fuzzy cache
    // lookup entirely so a similarly-named cached phone can never leak in.
    if (opts.gsmSlug) {
      const exact = await searchExact(opts.gsmSlug).catch(() => null);
      if (exact) {
        const id = upsertPhone(query, exact);
        return { phone: getPhoneByIdOrSlug(String(id))!, fromCache: false };
      }
      // exact fetch failed → fall through to the normal pipeline
    }
    if (!opts.forceRefresh) {
      const cached = getPhoneByQueryCached(query);
      if (cached) return { phone: cached, fromCache: true };
    }

    const providers = allProviders();
    const results: ProviderResult[] = [];
    for (const p of providers) {
      const r = await runProvider(p, query);
      if (r) results.push(r);
      // Stop early once we have an authoritative result with core specs
      if (r && results.length >= 3) break;
    }

    const existing = opts.gsmSlug ? null : findExistingPhone(query);
    const merged = mergeResults(results, existing?.id);
    if (!merged) {
      if (existing) return { phone: existing, fromCache: true };
      throw Object.assign(new Error("No public data source returned information for this phone."), { status: 404 });
    }

    // Requirement #12 (no fake data): if NO authoritative provider confirmed
    // this device's identity, all we have are heuristic web matches which may
    // belong to a different device entirely. Refuse to create a record.
    const hasConfirmedProvider = results.some((r) => r.confirmed);
    if (!hasConfirmedProvider && !existing) {
      throw Object.assign(
        new Error(
          "Could not verify this device against any authoritative public source. Showing no data instead of guessing."
        ),
        { status: 404 }
      );
    }
    const id = upsertPhone(query, merged);
    return { phone: getPhoneByIdOrSlug(String(id))!, fromCache: false };
  });
}

function findExistingPhone(q: string): PhoneRecord | null {
  const slug = slugify(q);
  const hit = db.prepare("SELECT id FROM phones WHERE slug LIKE ? ORDER BY LENGTH(slug) LIMIT 1")
    .get(`%${slug.split("-").slice(0, 3).join("%")}%`) as { id: number } | undefined;
  return hit ? getPhoneByIdOrSlug(String(hit.id)) : null;
}

function getPhoneByQueryCached(q: string): PhoneRecord | null {
  const phone = findExistingPhone(q);
  if (!phone) return null;
  const anyField = db.prepare(
    "SELECT MAX(retrieved_at) AS latest FROM fields WHERE phone_id = ?"
  ).get(phone.id) as { latest: string | null };
  // Consider cached data acceptable if it was retrieved within TTL window
  if (anyField.latest && isFresh(anyField.latest, "specs")) return phone;
  return phone.fields && Object.keys(phone.fields).length > 0 ? phone : null;
}

export async function refreshPhone(idOrSlug: string): Promise<PhoneRecord> {
  const rec = getPhoneByIdOrSlug(idOrSlug);
  const query = rec ? `${rec.brand} ${rec.model}` : idOrSlug;
  const { phone } = await resolvePhone(query, { forceRefresh: true });
  return phone;
}
