import type { PhoneDataProvider, ProviderResult, Suggestion } from "@/lib/types";
import { emptyResult, f } from "./base";
import { politeFetch } from "@/lib/fetch-compliance";

/**
 * GsmArenaMobileProvider — keyless discovery + full specification capture.
 *
 * 1. Search: GSMArena's public autocomplete index (quicksearch-*.jpg) is a
 *    JSON dataset of every device: [brandId, id, name, keywords, img, label].
 *    Cached in memory for 24h; matched with token scoring.
 * 2. Device page: m.gsmarena.com/<slug>-<id>.php exposes its spec table via
 *    `data-spec` attributes — parsed into the universal schema.
 * 3. Prices: the embedded pricing widget (variant → retailer offers).
 *
 * robots.txt on m.gsmarena.com does not disallow device pages or these
 * endpoints. Data is third-party curated → `verified`, never `official`.
 */

const BASE = "https://m.gsmarena.com";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const INDEX_TTL_MS = 24 * 3600_000;

interface IndexDevice {
  brandId: number;
  id: number;
  name: string;
  keywords: string;
  img: string;
  brand: string;
}

let indexCache: { devices: IndexDevice[]; at: number } | null = null;

async function loadIndex(): Promise<IndexDevice[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.devices;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await politeFetch(`${BASE}/quicksearch-82759.jpg`, {
      rateKey: `gsmarena_mobile_idx${attempt}`,
      perMinute: 4,
      timeoutMs: 30000,
      ua: MOBILE_UA,
      accept: "application/json,*/*",
    });
    if (res?.ok) {
      try {
        const j = (await res.json()) as [Record<string, string>, Array<[number, number, string, string, string, string?]>];
        const brands = j[0];
        const devices = (j[1] ?? []).map((row) => ({
          brandId: row[0],
          id: row[1],
          name: row[2],
          keywords: row[3] ?? "",
          img: row[4] ?? "",
          brand: brands[String(row[0])] ?? "",
        }));
        indexCache = { devices, at: Date.now() };
        return devices;
      } catch {
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return indexCache?.devices ?? [];
}

function slugifyGsm(brand: string, name: string): string {
  const combined = `${brand} ${name}`
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop region markers like "(China)"
    .replace(/\+/g, "_plus_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return combined;
}

/** Non-alphanumeric-insensitive form for fuzzy model matching ("gt 8" ≈ "gt8"). */
function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function findMatch(query: string): Promise<IndexDevice | null> {
  const best = await rankDevices(query, 1);
  return best[0]?.d ?? null;
}

/** Rank the whole index against a query; returns best matches first. */
async function rankDevices(query: string, limit = 8): Promise<Array<{ d: IndexDevice; score: number }>> {
  const devices = await loadIndex();
  if (devices.length === 0) return [];
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length >= 2) ?? [];
  const stop = new Set(["phone", "smartphone", "mobile"]);
  const req = tokens.filter((t) => !stop.has(t));
  if (req.length === 0) return [];
  const qCompact = compact(query);

  const scored: Array<{ d: IndexDevice; score: number }> = [];
  for (const d of devices) {
    const nameLower = d.name.toLowerCase();
    const fullCompact = compact(`${d.brand} ${d.name} ${d.keywords}`);
    let score = 0;
    let ok = true;

    if (qCompact.length >= 5) {
      if (compact(d.name).includes(qCompact)) score += 8;
      else if (fullCompact.includes(qCompact)) score += 6;
    }
    // EVERY token must be found (brand words included) — "iPhone 30 Ultra Max"
    // must never match "Edge 30 Ultra" just because 30+ultra are present.
    for (const t of req) {
      const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
      if (re.test(nameLower)) score += 2;
      else if (re.test(fullCompact)) score += 1;
      else {
        const c = compact(t);
        if (qCompact.length >= 5 && fullCompact.includes(qCompact)) continue; // full compact match covers all
        if (c.length >= 3 && fullCompact.includes(c)) { score += 1; continue; }
        ok = false;
        break;
      }
    }
    if (ok && score > 0) scored.push({ d, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Live AJAX suggestions for the search box (phone index, keyless). */
export async function suggestPhones(query: string, limit = 8): Promise<Suggestion[]> {
  const ranked = await rankDevices(query, limit);
  return ranked.map(({ d }) => {
    const cleanName = d.name.replace(/\(.*?\)/g, "").trim() || d.name;
    return {
      name: cleanName,
      brand: d.brand,
      gsmSlug: `${slugifyGsm(d.brand, cleanName)}-${d.id}`,
      image: d.img ? `https://fdn2.gsmarena.com/vv/bigpic/${d.img}` : undefined,
    };
  });
}

async function fetchWithRetry(url: string, perMinute: number, timeoutMs = 20000): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await politeFetch(url, {
      rateKey: attempt === 0 ? url : `${url}#${attempt}`,
      perMinute,
      timeoutMs,
      ua: MOBILE_UA,
    });
    if (res) return res;
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&thinsp;/g, "")
    .replace(/&#36;/g, "$")
    .replace(/&#8364;/g, "€")
    .replace(/&#163;/g, "£")
    .replace(/&#8377;/g, "₹")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePriceNum(s: string): number {
  return Number(s.replace(/[^\d.]/g, ""));
}

/** Extract all data-spec="key" → cleaned value pairs from the specs tables. */
function parseSpecs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /data-spec="([^"]+)"[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out[m[1]] = stripTags(m[2]);
  }
  return out;
}

interface SpecRow {
  section: string;
  label: string;
  key: string | null;
  value: string;
}

/**
 * Requirement: capture EVERY row of the specification sheet — including rows
 * without a data-spec attribute (Loudspeaker, EU label, …). Section headers
 * (<th>) are tracked so rows stay grouped exactly like the source.
 */
function parseAllSpecs(html: string): SpecRow[] {
  const rows: SpecRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let section = "General";
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const row = m[1];
    const thM = row.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    if (thM) {
      const s = stripTags(thM[1].replace(/<a[^>]*>[\s\S]*?<\/a>/gi, ""));
      if (s) section = s;
      continue;
    }
    const ttlM = row.match(/<td class="ttl"[^>]*>([\s\S]*?)<\/td>/i);
    const nfoM = row.match(/<td class="nfo"[^>]*>([\s\S]*?)<\/td>/i);
    if (!ttlM || !nfoM) continue;
    if (/&nbsp;|^\s*$/.test(ttlM[1])) continue; // continuation rows keep previous label context; skip labelless
    const label = stripTags(ttlM[1]);
    const value = stripTags(nfoM[1]);
    if (!label || !value) continue;
    const keyM = nfoM[1].match(/data-spec="([^"]+)"/i);
    rows.push({ section, label, key: keyM?.[1] ?? null, value });
  }
  return rows;
}

/**
 * Parse GSMArena's "Our Tests" section into real benchmark entries:
 * Performance row → AnTuTu / GeekBench / GFXBench scores; Display → measured
 * brightness; Loudspeaker → LUFS; Battery (old) → endurance hours.
 */
function parseOurTestsBenchmarks(rows: SpecRow[]): Array<{ name: string; version?: string; score: number; config?: string }> {
  const out: Array<{ name: string; version?: string; score: number; config?: string }> = [];
  const perf = rows.find((r) => /performance|bench/i.test(r.label));
  if (perf?.value) {
    for (const segRaw of perf.value.split("|")) {
      const seg = segRaw.trim();
      let m: RegExpExecArray | null;
      let m2: RegExpMatchArray | null;
      if ((m2 = seg.match(/^AnTuTu:\s*([\d,]+)/i))) {
        out.push({
          name: "AnTuTu",
          version: seg.match(/\((v[\d.]+)\)/i)?.[1],
          score: parsePriceNum(m2[1]),
        });
      } else if ((m2 = seg.match(/^GeekBench:\s*(.+)$/i))) {
        const pairs = [...m2[1].matchAll(/([\d,]+)\s*\((v[\d.]+)\)/gi)];
        if (pairs.length > 0) {
          for (const g of pairs) out.push({ name: "GeekBench", version: g[2], score: parsePriceNum(g[1]) });
        } else {
          const n = m2[1].match(/([\d,]+)/);
          if (n) out.push({ name: "GeekBench", score: parsePriceNum(n[1]) });
        }
      } else if ((m2 = seg.match(/^GFXBench:\s*([\d.]+)\s*fps?\s*\(([^)]+)\)/i))) {
        out.push({ name: "GFXBench", score: Number(m2[1]), config: m2[2] });
      } else if ((m2 = seg.match(/^GFXBench:\s*(.+)$/i))) {
        const n = m2[1].match(/([\d.]+)/);
        if (n) out.push({ name: "GFXBench", score: Number(n[1]), config: m2[1] });
      }
    }
  }
  const display = rows.find((r) => /^display$/i.test(r.label));
  if (display?.value) {
    const n = display.value.match(/([\d.]+)\s*nits/i);
    if (n) out.push({ name: "Display brightness (measured)", score: Number(n[1]), config: display.value });
  }
  const speaker = rows.find((r) => /loudspeaker/i.test(r.label));
  if (speaker?.value) {
    const n = speaker.value.match(/(-?[\d.]+)\s*LUFS/i);
    if (n) out.push({ name: "Loudspeaker", score: Number(n[1]), config: speaker.value });
  }
  const battery = rows.find((r) => /battery/i.test(r.label));
  if (battery?.value) {
    const n = battery.value.match(/Endurance rating\s*([\d.]+)\s*h/i);
    if (n) out.push({ name: "Battery endurance", score: Number(n[1]), config: battery.value });
  }
  return out;
}

function pathify(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Per-country offers from the dedicated price page. */
function parsePricePage(html: string): Array<{ variant: string; country: string; retailer: string; price: number; currency: string }> {
  const offers: Array<{ variant: string; country: string; retailer: string; price: number; currency: string }> = [];
  const detRe = /<details class="pricing"[^>]*>([\s\S]*?)<\/details>/gi;
  let dm: RegExpExecArray | null;
  while ((dm = detRe.exec(html))) {
    const block = dm[1];
    const country = stripTags(block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "") || "Unknown";
    let variant = "Standard";
    const partRe = /<span>([^<]{3,60})<\/span>|<li>([\s\S]*?)<\/li>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = partRe.exec(block))) {
      if (pm[1] !== undefined) {
        variant = stripTags(pm[1]);
        continue;
      }
      const li = pm[2];
      const storeM = li.match(/alt="([^"]+)"/i);
      const priceM = stripTags(li).match(/([$€£₹])\s*([\d.,]+)/);
      if (!priceM) continue;
      offers.push({
        variant,
        country,
        retailer: storeM?.[1] ?? "Retailer",
        price: parsePriceNum(priceM[2]),
        currency: priceM[1],
      });
    }
  }
  return offers.filter((o) => Number.isFinite(o.price));
}

interface Offer {
  variant: string;
  retailer: string;
  price: number;
  currency: string;
  url?: string;
}

function parsePrices(html: string): Offer[] {
  const offers: Offer[] = [];
  // pricing widget blocks: <span>VARIANT</span> <ul>…<li><img store>…<a href>PRICE</a></li>
  const blockRe = /<span>([^<]{3,60})<\/span>\s*<ul>([\s\S]*?)<\/ul>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(html))) {
    const variant = stripTags(bm[1]);
    const liRe = /<li>([\s\S]*?)<\/li>/gi;
    let lm: RegExpExecArray | null;
    while ((lm = liRe.exec(bm[2]))) {
      const li = lm[1];
      const hrefM = li.match(/href="(https?:\/\/[^"]+)"/);
      const text = stripTags(li);
      const pm = text.match(/([$€£₹])\s*([\d.,]+)/);
      const storeM = li.match(/stores\/([a-z-]+)\d?\.png/i);
      if (!pm) continue;
      offers.push({
        variant,
        currency: pm[1],
        price: parsePriceNum(pm[2]),
        retailer: storeM ? storeM[1].replace(/-(com|de|uk|co-in|co-uk)$/, "").toUpperCase() : "Retailer",
        url: hrefM?.[1],
      });
    }
  }
  // fallback: Misc price row "₹ 29,999 / € 359.99 ..."
  if (offers.length === 0) {
    const misc = html.match(/data-spec="price"[^>]*>([\s\S]*?)<\/td>/);
    if (misc) {
      const curMap: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR" };
      const pm = [...stripTags(misc[1]).matchAll(/([$€£₹])\s?([\d.,]+)/g)];
      for (const p of pm) {
        offers.push({
          variant: "Standard",
          currency: curMap[p[1]] ?? p[1],
          price: parsePriceNum(p[2]),
          retailer: "GSMArena listed price",
        });
      }
    }
  }
  return offers.filter((o) => Number.isFinite(o.price));
}

export class GsmArenaMobileProvider implements PhoneDataProvider {
  readonly key = "gsmarena_mobile";
  readonly label = "GSMArena mobile (full specifications)";
  readonly priority = 5;

  isConfigured() {
    return true;
  }

  async search(query: string): Promise<ProviderResult | null> {
    try {
      const match = await findMatch(query);
      if (!match) return null;
      return await captureDevice(match);
    } catch {
      return null;
    }
  }
}

interface MatchLike {
  brand: string;
  name: string;
  id: number;
  img?: string;
}

/** Fetch + fully parse a device page (specs, media, prices, 3D). */
async function captureDevice(match: MatchLike, exactSlug?: string): Promise<ProviderResult | null> {
  const cleanName = match.name.replace(/\(.*?\)/g, "").trim();
  const candidates = exactSlug
    ? [`${BASE}/${exactSlug}.php`]
    : [
        `${BASE}/${slugifyGsm(match.brand, cleanName)}-${match.id}.php`,
        `${BASE}/${slugifyGsm("", cleanName)}-${match.id}.php`,
        `${BASE}/${slugifyGsm(match.brand, match.name)}-${match.id}.php`,
        `${BASE}/${slugifyGsm("", match.name)}-${match.id}.php`,
      ];
  let html: string | null = null;
  let pageUrl: string | null = null;
  for (const url of [...new Set(candidates)]) {
    const res = await fetchWithRetry(url, 15);
    if (res?.ok) {
      const t = await res.text();
      if (t.includes("data-spec")) {
        html = t;
        pageUrl = url;
        break;
      }
    }
  }
  if (!html || !pageUrl) return null;
  return parseDevicePage(html, pageUrl, { ...match, name: cleanName || match.name });
}

/**
 * Exact lookup by GSMArena slug (e.g. "realme_8-10810") — used when the user
 * clicks a live suggestion, guaranteeing the clicked device is the one shown.
 */
export async function searchExact(gsmSlug: string): Promise<ProviderResult | null> {
  const m = gsmSlug.match(/^([a-z0-9_]+)-(\d+)$/i);
  if (!m) return null;
  const parts = m[1].split("_");
  const brand = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const name = parts.slice(1).join(" ") || brand;
  return captureDevice({ brand, name, id: Number(m[2]) }, gsmSlug);
}

async function parseDevicePage(
  html: string,
  pageUrl: string,
  match: MatchLike & { name: string }
): Promise<ProviderResult | null> {
  {
    const specs = parseSpecs(html);
      const src = "GSMArena";
      const S = (v: unknown, field: string, unit?: string) =>
        v != null && v !== ""
          ? { [field]: { value: v, unit, status: "verified" as const, source: src, sourceUrl: pageUrl } }
          : {};

      const out = emptyResult("gsmarena_mobile");
      out.confirmed = true;
      out.provider = "gsmarena_mobile";
      const h1 = html.match(/<h1 class="section[^"]*">\s*([^<]+?)\s*<\/h1>/i)?.[1];
      out.model = (h1 ?? match.name).trim();
      out.brand = match.brand;
      out.canonicalUrl = `https://www.gsmarena.com/${slugifyGsm(match.brand, match.name)}-${match.id}.php`;

      const img =
        html.match(/HISTORY_ITEM_IMAGE\s*=\s*"([^"]+)"/)?.[1] ??
        html.match(/<img[^>]+src=(https:\/\/fdn2\.gsmarena\.com\/vv\/bigpic\/[^ >]+)/i)?.[1] ??
        (match.img ? `https://fdn2.gsmarena.com/vv/bigpic/${match.img}` : null);
      out.imageUrl = img;

      Object.assign(out.fields, {
        ...S(specs["displaysize"]?.match(/(\d{1,2}(?:\.\d+)?)/)?.[1], "display.sizeInches", "in"),
        ...S(specs["displayresolution"], "display.resolution"),
        ...S(specs["displaytype"], "display.technology"),
        ...S(specs["chipset"], "performance.chipset"),
        ...S(specs["cpu"], "performance.cpu"),
        ...S(specs["gpu"], "performance.gpu"),
        ...S(specs["os"], "software.os"),
        ...S(specs["dimensions"], "body.dimensions"),
        ...S(specs["weight"], "body.weight"),
        ...S(specs["sim"], "connectivity.sim"),
        ...S(specs["wlan"], "connectivity.wifi"),
        ...S(specs["bluetooth"], "connectivity.bluetooth"),
        ...S(specs["gps"], "connectivity.gps"),
        ...S(specs["nfc"], "connectivity.nfc"),
        ...S(specs["usb"], "connectivity.usb"),
        ...S(specs["nettech"], "network.technology"),
        ...S(specs["batdescription1"], "battery.description"),
        ...S(specs["cam1features"], "camera.features"),
        ...S(specs["cam1video"], "camera.video"),
        ...S(specs["sensors"], "features.sensors"),
        ...S(specs["status"], "release.status"),
        ...S(specs["internalmemory"], "memory.internal"),
      });

      // RAM (from highlight, may be "8/12" → take max as headline)
      const ramHl = specs["ramsize-hl"]?.match(/(\d{1,2})/)?.[1];
      if (ramHl) Object.assign(out.fields, S(String(Number(ramHl)), "memory.ram", "GB"));

      // Battery
      const bat = specs["batsize-hl"]?.match(/(\d{4})/)?.[1];
      if (bat) Object.assign(out.fields, S(Number(bat), "battery.capacity", "mAh"));
      if (specs["battype-hl"]) Object.assign(out.fields, S(specs["battype-hl"], "battery.charging"));

      // Cameras: first MP of module lists
      const mainMp = specs["cam1modules"]?.match(/(\d{2,3})(?:\.\d)?\s?MP/i)?.[1];
      if (mainMp) Object.assign(out.fields, S(Number(mainMp), "camera.main", "MP"));
      const frontMp = specs["cam2modules"]?.match(/(\d{1,3})(?:\.\d)?\s?MP/i)?.[1];
      if (frontMp) Object.assign(out.fields, S(Number(frontMp), "camera.front", "MP"));

      // Release date from Announced/Released
      const announced = specs["year"] ?? "";
      const statusTxt = specs["status"] ?? "";
      const dateM = (announced + " " + statusTxt).match(
        /((?:19|20)\d{2},?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2}|(?:19|20)\d{2})/i
      );
      if (dateM) {
        out.releaseDate = dateM[1].trim();
        Object.assign(out.fields, f("release.date", { value: dateM[1].trim(), status: "verified", source: src, sourceUrl: pageUrl }));
      }

      // Variants: RAM/storage combos + colors + model numbers
      const internal = specs["internalmemory"];
      if (internal) {
        const comboRe = /(\d{2,4})GB\s+(\d{1,2})GB\s+RAM/gi;
        let cm: RegExpExecArray | null;
        const seen = new Set<string>();
        while ((cm = comboRe.exec(internal))) {
          const key = `${cm[2]}/${cm[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.variants.push({ storageGb: Number(cm[1]), ramGb: Number(cm[2]) });
          }
        }
      }
      if (specs["colors"])
        out.variants.push({ colors: specs["colors"].split(/,\s*/).map((c) => c.trim()).slice(0, 10) });
      if (specs["models"]) out.variants.push({ modelNumber: specs["models"] });

      // Prices embedded on the spec page
      for (const offer of parsePrices(html)) {
        out.prices.push({
          variant: offer.variant,
          price: offer.price,
          currency: offer.currency,
          country: undefined,
          retailer: offer.retailer,
          url: offer.url,
          status: "verified",
          retrievedAt: new Date().toISOString(),
        });
      }

      // ---- Full specification sheet: EVERY row, grouped by section ----
      const allRows = parseAllSpecs(html);
      for (const row of allRows) {
        Object.assign(
          out.fields,
          f(`gsma.${pathify(row.section)}.${pathify(row.label)}`, {
            value: row.value,
            status: "verified",
            source: src,
            sourceUrl: pageUrl,
          })
        );
      }

      // ---- Benchmarks from the "Our Tests" section (real measured scores) ----
      // e.g. "AnTuTu: 298328 (v8) | GeekBench: 6779 (v4.4), 1680 (v5.1) |
      //       GFXBench: 18fps (ES 3.1 onscreen)"
      const nowIso = new Date().toISOString();
      const ourTestRows = allRows.filter((r) => /our\s*tests/i.test(r.section));
      for (const b of parseOurTestsBenchmarks(ourTestRows)) {
        out.benchmarks.push({
          name: b.name,
          version: b.version,
          score: b.score,
          configJson: b.config,
          status: "verified",
          source: src,
          sourceUrl: pageUrl,
          retrievedAt: nowIso,
        });
      }

      // ---- Dedicated price page: per-country best offers ----
      try {
        const priceLink = html.match(/href="?([a-z0-9_+]+-price-\d+\.php)/i)?.[1];
        const priceUrl = priceLink ? `${BASE}/${priceLink}` : null;
        if (priceUrl) {
          const pres2 = await fetchWithRetry(priceUrl, 10);
          if (pres2?.ok) {
            for (const offer of parsePricePage(await pres2.text())) {
              out.prices.push({
                variant: offer.variant,
                price: offer.price,
                currency: offer.currency,
                country: offer.country,
                retailer: offer.retailer,
                url: priceUrl,
                status: "verified",
                retrievedAt: new Date().toISOString(),
              });
            }
          }
        }
      } catch {
        // prices are optional
      }

      // ---- Live media: news + reviews via search-json.php3 ----
      try {
        // The endpoint matches keyword prefixes — always include the brand,
        // then fall back to shorter forms.
        const terms = [
          `${match.brand} ${match.name}`.trim(),
          `${match.brand} ${match.name.split(" ").slice(0, 2).join(" ")}`.trim(),
          `${match.brand} ${match.name.split(" ")[0]}`.trim(),
        ];
        type SearchJson = { news?: Array<{ href: string; text: string; src?: string }>; reviews?: Array<{ href: string; text: string; src?: string }> };
        let data: SearchJson | null = null;
        for (const term of terms) {
          const sj = await fetchWithRetry(
            `${BASE}/search-json.php3?sSearch=${encodeURIComponent(term)}`,
            15,
            15000
          );
          if (sj?.ok) {
            const parsed = (await sj.json()) as SearchJson;
            if ((parsed?.news?.length ?? 0) + (parsed?.reviews?.length ?? 0) > 0) {
              data = parsed;
              break;
            }
            if (!data) data = parsed;
          }
        }
        if (data) {
          for (const n of data.news ?? []) {
            out.media!.push({
              kind: "news",
              title: n.text,
              url: n.href.startsWith("http") ? n.href : `${BASE}/${n.href}`,
              imageUrl: n.src,
            });
          }
          for (const rv of data.reviews ?? []) {
            out.media!.push({
              kind: "review",
              title: rv.text,
              url: rv.href.startsWith("http") ? rv.href : `${BASE}/${rv.href}`,
              imageUrl: rv.src,
            });
          }
        }
      } catch {
        // media is optional — specs already captured
      }

      // ---- Photo gallery + official 3D model from the pictures page ----
      // Captures EVERYTHING: official renders, hands-on/"our photos" shots.
      try {
        const picsUrl = `${pageUrl!.replace(/\.php$/, "").replace(/^(.*?)-\d+$/, "$1")}-pictures-${match.id}.php`;
        const pr = await fetchWithRetry(picsUrl, 10);
        if (pr?.ok) {
          const ph = await pr.text();
          const seenPics = new Set<string>();
          const pushPic = (u: string, kind: "official" | "hands-on") => {
            if (!u || seenPics.has(u) || u.includes("imgroot/static") || u.includes("bigpic")) return;
            seenPics.add(u);
            out.media!.push({
              kind: "gallery",
              title: kind === "official" ? `${out.model} official image` : `${out.model} hands-on photo`,
              url: u,
              imageUrl: u,
            });
          };
          // 1) explicit official renders (class="official" and /vv/pics/ paths)
          for (const im of ph.matchAll(/<img[^>]+class="official"[^>]*src="([^"]+)"|<img[^>]+src="([^"]+)"[^>]+class="official"/gi)) {
            pushPic(im[1] ?? im[2], "official");
          }
          // 2) every other content image (src + lazy data-src), classified by path
          for (const im of ph.matchAll(/(?:data-src|src)="(https?:\/\/[^"]+(?:jpg|jpeg|png|webp)[^"]*)"/gi)) {
            const u = im[1];
            if (seenPics.has(u)) continue;
            pushPic(u, u.includes("/vv/pics/") ? "official" : "hands-on");
          }
          // 3D model: integration id + color swatch content-ids
          const integration = ph.match(/embed\.binkies3d\.com\/integrations\/([^/]+)\//i)?.[1];
          const swatches = [...ph.matchAll(/data-binkies-content-id="([^"]+)"[^>]*>([^<]+)</gi)];
          if (integration && swatches.length > 0) {
            for (const sw of swatches) {
              out.media!.push({
                kind: "model3d",
                title: sw[2].trim(),
                url: `binkies://${integration}/${sw[1]}`,
              });
            }
          }
        }
      } catch {
        // gallery is optional
      }

      return Object.keys(out.fields).length > 0 ? out : null;
  }
}
