import type { PhoneDataProvider, ProviderResult } from "@/lib/types";
import { emptyResult } from "./base";
import { politeFetch } from "@/lib/fetch-compliance";

/**
 * GsmArenaCommunityProvider — optional adapter for a GSMArena community/unofficial
 * API instance (e.g. self-hosted gsmarena-api). Disabled unless
 * GSMARENA_API_BASE is configured. Data is third-party curated → `verified`
 * at best (never `official`).
 *
 * Expected endpoints (community API convention):
 *   GET {base}/search.php?q=<query>   → [{ id, name }]
 *   GET {base}/device.php?id=<id>     → device spec object
 */
export class GsmArenaCommunityProvider implements PhoneDataProvider {
  readonly key = "gsmarena_community";
  readonly label = "GSMArena (community API)";
  readonly priority = 10;

  isConfigured() {
    return Boolean(process.env.GSMARENA_API_BASE);
  }

  async search(query: string): Promise<ProviderResult | null> {
    const base = process.env.GSMARENA_API_BASE;
    if (!base) return null;
    try {
      const sres = await politeFetch(
        `${base.replace(/\/$/, "")}/search.php?q=${encodeURIComponent(query)}`,
        { rateKey: this.key, perMinute: 20, accept: "application/json" }
      );
      if (!sres?.ok) return null;
      const list = (await sres.json()) as Array<{ id: string | number; name: string }>;
      if (!Array.isArray(list) || list.length === 0) return null;

      const dres = await politeFetch(`${base.replace(/\/$/, "")}/device.php?id=${list[0].id}`, {
        rateKey: this.key,
        perMinute: 20,
        accept: "application/json",
      });
      if (!dres?.ok) return null;
      const d = (await dres.json()) as Record<string, unknown>;
      const num = (k: string): number | null => {
        const v = d[k];
        const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const str = (k: string): string | undefined => {
        const v = d[k];
        return typeof v === "string" && v ? v : undefined;
      };

      const out = emptyResult(this.key);
      out.confirmed = true;
      out.model = str("name") ?? query;
      out.brand = str("brand");
      out.imageUrl = str("image");
      out.canonicalUrl = str("url") ?? undefined;

      const src = "GSMArena (community)";
      const S = (v: unknown, field: string, unit?: string, note?: string) =>
        v != null ? { [field]: { value: v, unit, status: "verified" as const, source: src, sourceUrl: out.canonicalUrl, note } } : {};

      Object.assign(out.fields, {
        ...S(num("display_size"), "display.sizeInches", "in"),
        ...S(str("display_resolution"), "display.resolution"),
        ...S(str("display_tech"), "display.technology"),
        ...S(str("chipset"), "performance.chipset"),
        ...S(str("gpu"), "performance.gpu"),
        ...S(num("ram"), "memory.ram", "GB"),
        ...S(num("storage"), "memory.storage", "GB"),
        ...S(num("battery"), "battery.capacity", "mAh"),
        ...S(str("charging"), "battery.charging"),
        ...S(str("main_camera"), "camera.main"),
        ...S(str("front_camera"), "camera.front"),
        ...S(str("os"), "software.os"),
        ...S(num("weight"), "body.weight", "g"),
        ...S(str("dimensions"), "body.dimensions"),
        ...S(str("release_date"), "release.date"),
      });
      if (typeof d.colors === "string")
        out.variants.push({ colors: d.colors.split(",").map((c) => c.trim()) });

      // Benchmarks only when the source actually reports them:
      const antutu = num("antutu");
      if (antutu != null)
        out.benchmarks.push({
          name: "AnTuTu",
          score: antutu,
          status: "verified",
          source: src,
          sourceUrl: out.canonicalUrl,
        });
      return out;
    } catch {
      return null;
    }
  }
}
