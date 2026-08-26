import type { Confidence, PhoneDataProvider, ProviderResult } from "@/lib/types";
import { emptyResult, f } from "./base";
import { politeFetch } from "@/lib/fetch-compliance";

/**
 * WikipediaProvider â€” device articles via the official MediaWiki API
 * (keyless, robots-permitted, CC BY-SA). Infobox values are community
 * curated and typically referenced â†’ tagged `verified`.
 */

const API = "https://en.wikipedia.org/w/api.php";

/** Match nested {{â€¦}} / [[â€¦]] structures to find the real end of a template. */
function extractTemplate(wiki: string, name: string): string | null {
  const m = wiki.match(new RegExp(`\\{\\{\\s*${name}`, "i"));
  if (!m || m.index == null) return null;
  let depth = 0;
  let i = m.index;
  for (; i < wiki.length - 1; i++) {
    if (wiki[i] === "{" && wiki[i + 1] === "{") { depth++; i++; }
    else if (wiki[i] === "}" && wiki[i + 1] === "}") { depth--; i++; if (depth === 0) return wiki.slice(m.index, i + 1); }
    else if (wiki[i] === "[" && wiki[i + 1] === "[") { depth++; i++; }
    else if (wiki[i] === "]" && wiki[i + 1] === "]") { depth--; i++; }
  }
  return null;
}

/** Split template body into keyâ†’value params at top nesting level only. */
function parseParams(tpl: string): Record<string, string> {
  const body = tpl.replace(/^{{\s*\w+\s*/, "").replace(/}}\s*$/, "");
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i], n = body[i + 1];
    if ((c === "{" && n === "{") || (c === "[" && n === "[")) { depth += 2; cur += c + n; i++; continue; }
    if ((c === "}" && n === "}") || (c === "]" && n === "]")) { depth -= 2; cur += c + n; i++; continue; }
    if (c === "|" && depth <= 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  const map: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    map[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return map;
}

function cleanWiki(s: string): string {
  return s
    .replace(/<ref[\s\S]*?<\/ref>/gi, " ")
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/'''?([^']+)'''?/g, "$1")
    .replace(/\{\{\s*(?:plainlist|flatlist|unbulleted list|ubl|hlist)\s*\|([\s\S]*?)\}\}/gi,
      (_m, inner: string) => inner.split(/\*/).map((x) => x.trim()).filter(Boolean).join(", "))
    .replace(/\{\{\s*(?:start date and age|start date|dfn)\s*\|(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})[\s\S]*?\}\}/i,
      (_m, y: string, mo: string, d: string) => `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`)
    .replace(/\{\{\s*convert\s*\|([\s\S]*?)\}\}/gi, (_m, inner: string) => inner.split("|").slice(0, 2).join(" "))
    .replace(/\{\{\s*color sample\s*\|([^}]*)\}\}/gi, "")
    .replace(/\{\{([\s\S]*?)\}\}/g, (_m, inner: string) => inner.split("|").map((p: string) => p.trim()).filter(Boolean).slice(1).join(" "))
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class WikipediaProvider implements PhoneDataProvider {
  readonly key = "wikipedia";
  readonly label = "Wikipedia (device articles)";
  readonly priority = 15;

  isConfigured() {
    return true;
  }

  async search(query: string): Promise<ProviderResult | null> {
    try {
      const sres = await politeFetch(
        `${API}?action=query&list=search&srsearch=${encodeURIComponent(query + " smartphone")}&srlimit=5&format=json&origin=*`,
        { rateKey: this.key, perMinute: 30, accept: "application/json", timeoutMs: 10000, apiExempt: true }
      );
      if (!sres?.ok) return null;
      const sdata = (await sres.json()) as { query?: { search?: Array<{ title: string }> } };
      const hits = sdata.query?.search ?? [];

      // Identity guard: if the query carries a specific model token (e.g. "7a",
      // "s25"), the article title must contain it with word boundaries â€”
      // prevents cross-model data ("30" must not match "300").
      const tokens = query.toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length >= 2) ?? [];
      const stop = new Set(["google", "samsung", "phone", "smartphone", "mobile"]);
      const req = tokens.filter((t) => !stop.has(t));
      const digitToks = req.filter((t) => /\d/.test(t));
      const bounded = (t: string) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`);

      // Rank candidates by how many query tokens the title covers; the top
      // candidate must at least cover every model-number token.
      const scored = hits
        .map((h) => ({
          hit: h,
          score: req.filter((t) => bounded(t).test(h.title.toLowerCase())).length,
        }))
        .filter((x) => digitToks.every((t) => bounded(t).test(x.hit.title.toLowerCase())))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best) return null;
      const hit = best.hit;

      // Variant guard: if the article title misses descriptive tokens
      // ("ultra", "pro", "fe"â€¦), this is a FAMILY article â€” its values may
      // differ per variant, so everything is downgraded to `estimated`.
      const titleLower = hit.title.toLowerCase();
      const missingWords = req.filter((t) => !/\d/.test(t) && !bounded(t).test(titleLower));
      const variantPenalty = missingWords.length > 0;
      const defaultStatus: Confidence = variantPenalty ? "estimated" : "verified";
      const penaltyNote = variantPenalty
        ? `Matched family article "${hit.title}" (${missingWords.join(", ")} not in title); values may vary between variants`
        : undefined;

      const pres = await politeFetch(
        `${API}?action=parse&page=${encodeURIComponent(hit.title)}&prop=wikitext&redirects=1&format=json&origin=*`,
        { rateKey: this.key, perMinute: 30, accept: "application/json", timeoutMs: 12000, apiExempt: true }
      );
      if (!pres?.ok) return null;
      const pdata = (await pres.json()) as { parse?: { wikitext?: { "*": string } } };
      const wiki = pdata.parse?.wikitext?.["*"] ?? "";
      const tpl = extractTemplate(wiki, "Infobox");
      if (!tpl) return null;
      const ib = parseParams(tpl);

      const out = emptyResult(this.key);
      out.confirmed = true;
      out.model = variantPenalty
        ? query // keep the exact variant the user asked for
        : cleanWiki(hit.title.replace(/\(.*\)/, "")).trim();
      out.canonicalUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`;
      const src = "Wikipedia";
      const srcUrl = out.canonicalUrl;

      const val = (...keys: string[]): string | null => {
        for (const k of keys) {
          const raw = ib[k];
          if (!raw) continue;
          const cleaned = cleanWiki(raw);
          if (cleaned && !/^[-â€“â€”?]$/.test(cleaned)) return cleaned;
        }
        return null;
      };
      /** Extract a number only when bound to its expected unit (prevents
       *  grabbing stray model numbers like "S25" as "25 GB"). */
      const unitNum = (v: string, units: string[]): number | null => {
        if (!v) return null;
        for (const u of units) {
          const m = v.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${u}`, "i"));
          if (m) return Number(m[1]);
        }
        // bare-number fallback only when the value is short and purely numeric
        const bare = v.match(/^(\d+(?:\.\d+)?)$/);
        return bare ? Number(bare[1]) : null;
      };
      const put = (field: string, raw: unknown, unit?: string) =>
        Object.assign(
          out.fields,
          f(field, { value: raw ?? null, unit, status: defaultStatus, source: src, sourceUrl: srcUrl, note: penaltyNote })
        );

      const brand = val("brand");
      if (brand) out.brand = brand;

      const soc = val("soc", "cpu", "chipset", "system_on_chip");
      if (soc) put("performance.chipset", soc);

      const gpu = val("gpu");
      if (gpu) put("performance.gpu", gpu);

      const ramVal = val("memory", "ram");
      const ram = unitNum(ramVal ?? "", ["GB", "TB"]);
      if (ram != null && ram >= 1 && ram <= 64) put("memory.ram", ram, "GB");

      const storageRaw = val("storage", "memory_storage") ?? "";
      let storage = unitNum(storageRaw, ["GB"]);
      if (storage == null) {
        const tb = unitNum(storageRaw, ["TB"]);
        if (tb != null) storage = tb * 1024;
      }
      if (storage != null && storage >= 4 && storage <= 4096) put("memory.storage", storage, "GB");

      const battery = unitNum(val("battery", "battery_capacity") ?? "", ["mAh"]);
      if (battery != null && battery >= 400 && battery <= 20000) put("battery.capacity", battery, "mAh");

      const charging = val("charging", "fast_charge");
      if (charging) put("battery.charging", charging);

      const displaySize = val("display", "screen_size", "screensize", "display_size");
      const inch = displaySize?.match(/(\d{1,2}(?:\.\d)?)\s*(?:in\b|inch|")/i)?.[1];
      if (inch) put("display.sizeInches", Number(inch), "in");
      const resM = displaySize?.match(/(\d{3,4})\s?[xÃ—]\s?(\d{3,4})/i);
      if (resM) put("display.resolution", `${resM[1]} Ã— ${resM[2]}`);

      const camera = val("camera", "rear_camera", "back_camera");
      const mp = camera?.match(/(\d{2,3})(?:\.\d)?\s?(?:MP|megapixel)/i)?.[1];
      if (mp) put("camera.main", Number(mp), "MP");

      const weightRaw = val("weight");
      const wg = weightRaw ? unitNum(cleanWiki(weightRaw), ["g", "oz", "grams"]) : null;
      if (wg != null && wg >= 50 && wg <= 800) put("body.weight", wg, "g");

      const os = val("os", "operating_system");
      if (os) put("software.os", os);

      const colors = val("colors");
      if (colors) out.variants.push({ colors: colors.split(/,|\//).map((c) => c.trim()).filter(Boolean).slice(0, 8) });

      const released = val("released", "release_date", "first_release", "availability");
      if (released) {
        const iso = released.match(/(\d{4}-\d{2}-\d{2})/);
        const human = released.match(/(\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\b(?:19|20)\d{2}\b)/);
        const dateStr = iso?.[1] ?? human?.[1];
        if (dateStr) {
          out.releaseDate = dateStr;
          put("release.date", dateStr);
        }
      }

      const modelNumber = val("model_number", "model number", "models");
      if (modelNumber) out.variants.push({ modelNumber });

      return Object.keys(out.fields).length > 0 ? out : null;
    } catch {
      return null;
    }
  }
}
