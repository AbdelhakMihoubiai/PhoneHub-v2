import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";
import db from "@/lib/db";
import { slugify } from "@/lib/providers/base";
import { addDatasetConfig } from "@/lib/providers/opendataset";

export const runtime = "nodejs";

/**
 * POST /api/import — open dataset import (requirement #14).
 *
 * Body (multipart/form-data):
 *   file        — JSON | CSV | XML
 *   name        — dataset name
 *   format      — json | csv | xml (auto-detected from extension if omitted)
 *   recordPath  — optional dot path to the records array
 *   nameField   — field used for model matching
 *   brandField  — field used for brand
 *   mapping     — JSON string: { "external_field": "internal.dot.path", ... }
 *
 * The file is stored under data/datasets/ and registered so the
 * OpenDatasetProvider can serve it during live lookups.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const name = String(form.get("name") ?? "Imported dataset");
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

    let fmt = String(form.get("format") ?? "");
    if (!fmt) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      fmt = ext === "csv" ? "csv" : ext === "xml" ? "xml" : ext === "json" ? "json" : "";
    }
    if (!["json", "csv", "xml"].includes(fmt))
      return NextResponse.json({ error: "Unsupported format; use json/csv/xml" }, { status: 400 });

    const text = await file.text();
    const recordPath = String(form.get("recordPath") ?? "");
    let mapping: Record<string, string> = {};
    try {
      mapping = JSON.parse(String(form.get("mapping") ?? "{}"));
    } catch {
      return NextResponse.json({ error: "mapping must be valid JSON" }, { status: 400 });
    }
    const nameField = String(form.get("nameField") ?? "model");
    const brandField = String(form.get("brandField") ?? "brand");

    // Parse & count records to validate the import
    let rows: unknown[] = [];
    if (fmt === "csv") {
      rows = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true }).data;
    } else if (fmt === "json") {
      let j: unknown = JSON.parse(text);
      for (const seg of recordPath.split(".").filter(Boolean)) j = (j as Record<string, unknown>)?.[seg] ?? [];
      rows = Array.isArray(j) ? j : [j];
    } else {
      const parser = new XMLParser({ ignoreAttributes: false });
      let doc = parser.parse(text) as Record<string, unknown>;
      for (const seg of recordPath.split(".").filter(Boolean)) doc = (doc[seg] as Record<string, unknown>) ?? {};
      rows = Array.isArray(doc) ? doc : [doc];
    }

    // Persist the dataset and register it
    fs.mkdirSync(path.join(process.cwd(), "data", "datasets"), { recursive: true });
    const filename = `${slugify(name)}.${fmt}`;
    fs.writeFileSync(path.join(process.cwd(), "data", "datasets", filename), text);

    addDatasetConfig({
      name,
      source: filename,
      format: fmt as "json" | "csv" | "xml",
      status: "user_submitted",
      recordPath: recordPath || undefined,
      mapping,
      nameField,
      brandField,
    });

    db.prepare("INSERT INTO provider_logs (provider_key, query, ok) VALUES (?, ?, 1)").run(
      "import",
      `${name}: ${rows.length} records`
    );

    return NextResponse.json({ ok: true, records: rows.length, file: filename });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 }
    );
  }
}
