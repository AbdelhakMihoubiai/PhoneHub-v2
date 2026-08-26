import type { PhoneDataProvider, ProviderResult } from "@/lib/types";
import { emptyResult, f } from "./base";
import { politeFetch } from "@/lib/fetch-compliance";

/**
 * WikidataProvider â€” structured open data (CC0) via the official Wikidata API.
 * Legitimate, keyless, robots-friendly. Coverage varies per device; fields
 * found here are tagged `verified` (curated open dataset).
 *
 * Relevant properties: P31 instance of, P176 manufacturer,
 * P3061 battery capacity, P2928 display size... coverage is partial by
 * nature â€” missing properties simply return no fields.
 */

const API = "https://www.wikidata.org/w/api.php";

interface WDEntity {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value: unknown } } }>>;
}

function firstClaim(e: WDEntity, prop: string): unknown {
  const c = e.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
  return c ?? null;
}

export class WikidataProvider implements PhoneDataProvider {
  readonly key = "wikidata";
  readonly label = "Wikidata (open structured data)";
  readonly priority = 20;

  isConfigured() {
    return true;
  }

  async search(query: string): Promise<ProviderResult | null> {
    try {
      const res = await politeFetch(
        `${API}?action=wbsearchentities&search=${encodeURIComponent(query + " smartphone")}` +
        `&language=en&format=json&limit=5&origin=*`,
        { rateKey: this.key, perMinute: 30, accept: "application/json", timeoutMs: 10000, apiExempt: true }
      );
      if (!res?.ok) return null;
      const data = (await res.json()) as { search?: Array<{ id: string; label?: string; description?: string }> };
      const candidates = (data.search ?? []).filter(
        (s) =>
          /phone|smartphone|mobile/i.test(s.description ?? "") ||
          /iphone|galaxy|pixel|redmi/i.test(s.label ?? "")
      );
      const hit = candidates[0];
      if (!hit) return null;

      const entityRes = await politeFetch(
        `${API}?action=wbgetentities&ids=${hit.id}&props=labels|descriptions|claims&languages=en&format=json&origin=*`,
        { rateKey: this.key, perMinute: 30, accept: "application/json", timeoutMs: 10000, apiExempt: true }
      );
      if (!entityRes?.ok) return null;
      const ed = (await entityRes.json()) as { entities?: Record<string, WDEntity> };
      const e = ed.entities?.[hit.id];
      if (!e) return null;

      const out = emptyResult(this.key);
      out.confirmed = true;
      out.model = e.labels?.en?.value ?? hit.label;
      out.brand = undefined; // resolved from manufacturer claim below when present
      out.canonicalUrl = `https://www.wikidata.org/wiki/${hit.id}`;

      const manuf = firstClaim(e, "P176");
      if (typeof manuf === "string" || typeof manuf === "number") {
        // numeric entity id â†’ resolve label
        const idStr = String(manuf);
        if (/^Q\d+$/.test(idStr)) {
          const r = await politeFetch(`${API}?action=wbgetentities&ids=${idStr}&props=labels&languages=en&format=json&origin=*`, { rateKey: this.key, perMinute: 30, accept: "application/json", timeoutMs: 8000, apiExempt: true });
          if (r?.ok) {
            const jd = (await r.json()) as { entities?: Record<string, WDEntity> };
            const label = jd.entities?.[idStr]?.labels?.en?.value;
            if (label) out.brand = label;
          }
        }
      }

      const src = "Wikidata";
      const srcUrl = `https://www.wikidata.org/wiki/${hit.id}`;
      const desc = e.descriptions?.en?.value;
      Object.assign(
        out.fields,
        f("general.description", {
          value: desc ?? null,
          status: "verified",
          source: src,
          sourceUrl: srcUrl,
        })
      );

      // Battery capacity in joules on Wikidata â†’ convert to mAh estimate only if voltage known; else skip.
      // We deliberately do NOT convert without a stated voltage (no fake data).
      const release = firstClaim(e, "P577"); // inception/publication date
      if (typeof release === "object" && release !== null && "time" in (release as object)) {
        const t = (release as { time: string }).time.slice(0, 10);
        out.releaseDate = t;
        Object.assign(out.fields, f("release.date", { value: t, status: "verified", source: src, sourceUrl: srcUrl }));
      }
      return out;
    } catch {
      return null;
    }
  }
}
