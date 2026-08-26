import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";
import type { PhoneDataProvider, ProviderResult } from "@/lib/types";
import { emptyResult, f, normalizeQuery, slugify } from "./base";

/**
 * Requirement #14: Open dataset import provider.
 * Loads JSON / CSV / XML datasets from local `data/datasets/` or remote URLs
 * listed in `data/datasets.json`. Each dataset has an explicit field mapping,
 * e.g. { "external_name": "model", "battery_capacity": "battery.capacity" }.
 */

interface DatasetConfig {
  name: string;
  source: string; // URL or local filename inside data/datasets/
  format: "json" | "csv" | "xml";
  status: "verified" | "multiple_sources" | "user_submitted";
  recordPath?: string; // for XML / nested JSON
  mapping: Record<string, string>; // external field → internal dot path
  nameField?: string; // field used to match the query (defaults to model/external_name)
  brandField?: string;
}

function loadDatasetConfigs(): DatasetConfig[] {
  const cfgPath = path.join(process.cwd(), "data", "datasets.json");
  if (!fs.existsSync(cfgPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as DatasetConfig[];
  } catch {
    return [];
  }
}

type Row = Record<string, unknown>;

async function loadRows(cfg: DatasetConfig): Promise<Row[]> {
  const isUrl = /^https?:\/\//.test(cfg.source);
  const text = isUrl
    ? await (async () => {
        const res = await fetch(cfg.source, { signal: AbortSignal.timeout(15000) });
        return res.ok ? res.text() : "";
      })()
    : (() => {
        const p = path.join(process.cwd(), "data", "datasets", cfg.source);
        return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
      })();
  if (!text) return [];

  if (cfg.format === "csv") {
    const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
    return parsed.data;
  }
  if (cfg.format === "xml") {
    const parser = new XMLParser({ ignoreAttributes: false });
    let doc = parser.parse(text) as Record<string, unknown>;
    for (const seg of (cfg.recordPath ?? "").split(".").filter(Boolean)) {
      doc = (doc[seg] as Record<string, unknown>) ?? {};
    }
    const arr = Array.isArray(doc) ? doc : doc.record ?? doc.item ?? doc.entry ?? [];
    return Array.isArray(arr) ? (arr as Row[]) : [arr as Row];
  }
  // json
  let json: unknown = JSON.parse(text);
  for (const seg of (cfg.recordPath ?? "").split(".").filter(Boolean)) {
    const next = (json as Record<string, unknown>)?.[seg];
    json = next;
    if (json == null) break;
  }
  return Array.isArray(json) ? (json as Row[]) : [];
}

export class OpenDatasetProvider implements PhoneDataProvider {
  readonly key = "open_dataset";
  readonly label = "Open datasets (community curated)";
  readonly priority = 30;

  isConfigured() {
    return loadDatasetConfigs().length > 0;
  }

  async search(query: string): Promise<ProviderResult | null> {
    const q = normalizeQuery(query);
    const tokens = q.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);

    for (const cfg of loadDatasetConfigs()) {
      try {
        const rows = await loadRows(cfg);
        const match = rows.find((r) => {
          const hay = cfg.nameField
            ? String(r[cfg.nameField] ?? "")
            : String(r.model ?? r.name ?? r.external_name ?? r.device ?? "");
          const brand = String(r[cfg.brandField ?? ""] ?? "");
          const norm = `${brand} ${hay}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
          return tokens.every((t) => norm.includes(t));
        });
        if (!match) continue;

        const out = emptyResult(this.key);
        out.provider = `${this.key}:${cfg.name}`;
        out.confirmed = true;
        out.canonicalUrl = /^https?:\/\//.test(cfg.source) ? cfg.source : undefined;

        for (const [ext, internal] of Object.entries(cfg.mapping)) {
          const v = match[ext];
          if (v == null || v === "") continue;
          Object.assign(
            out.fields,
            f(internal, { value: v, status: cfg.status, source: cfg.name })
          );
          if (internal === "general.brand") out.brand = String(v);
          if (internal === "general.model") out.model = String(v);
          if (internal === "release.date") out.releaseDate = String(v);
        }
        if (!out.model) {
          out.model =
            String(match[cfg.nameField ?? "model"] ?? match.name ?? query);
        }
        return out;
      } catch {
        continue;
      }
    }
    return null;
  }
}

/** Helper used by the admin importer to append a dataset config. */
export function addDatasetConfig(cfg: DatasetConfig): void {
  const cfgPath = path.join(process.cwd(), "data", "datasets.json");
  const list = loadDatasetConfigs();
  list.push(cfg);
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(list, null, 2));
}

export function suggestSlug(brand: string | undefined, model: string): string {
  return slugify(`${brand ?? ""} ${model}`);
}
