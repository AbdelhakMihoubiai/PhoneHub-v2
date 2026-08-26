import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { providerStatuses } from "@/lib/aggregator";

export const runtime = "nodejs";

// GET /api/admin/providers — provider config, logs, conflicts
export async function GET() {
  const statuses = providerStatuses();
  const configuredKeys = new Set(statuses.map((s) => s.key));

  // Ensure a row exists per known provider for admin editing (without keys)
  const ins = db.prepare(
    "INSERT OR IGNORE INTO providers (key, label, priority) VALUES (?, ?, ?)"
  );
  const defaults: Record<string, { label: string; priority: number; env?: string }> = {
    gsmarena_mobile: { label: "GSMArena mobile (full specifications)", priority: 5 },
    gsmarena_community: { label: "GSMArena (community API)", priority: 10, env: "GSMARENA_API_BASE" },
    wikipedia: { label: "Wikipedia (device articles)", priority: 15 },
    wikidata: { label: "Wikidata (open structured data)", priority: 20 },
    open_dataset: { label: "Open datasets", priority: 30 },
    web_search: { label: "Web research (DuckDuckGo/Bing)", priority: 90, env: "SERPAPI_KEY" },
  };
  for (const [key, d] of Object.entries(defaults)) {
    ins.run(key, d.label, d.priority);
  }

  const rows = db.prepare("SELECT * FROM providers ORDER BY priority").all() as Array<{
    key: string; label: string; enabled: number; priority: number;
    rate_limit_per_min: number; api_key_env: string | null; last_error: string | null; fail_count: number;
  }>;

  const logs = db.prepare(
    "SELECT provider_key, query, ok, error, at FROM provider_logs ORDER BY at DESC LIMIT 50"
  ).all();
  const conflicts = db.prepare(
    `SELECT c.*, p.brand || ' ' || p.model AS phone FROM conflicts c JOIN phones p ON p.id = c.phone_id
     ORDER BY c.created_at DESC LIMIT 50`
  ).all();

  return NextResponse.json({
    providers: rows.map((r) => ({
      ...r,
      live_configured: configuredKeys.has(r.key),
      api_key_env: r.api_key_env ?? defaults[r.key]?.env ?? null,
    })),
    logs,
    conflicts,
  });
}

// PUT /api/admin/providers — update enable/priority/rate-limit/env-var-name
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    key: string; enabled?: boolean; priority?: number;
    rate_limit_per_min?: number; api_key_env?: string | null;
  };
  if (!body?.key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const cur = db.prepare("SELECT * FROM providers WHERE key = ?").get(body.key) as
    | { label: string; enabled: number; priority: number; rate_limit_per_min: number }
    | undefined;
  if (!cur) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  db.prepare(
    `UPDATE providers SET enabled=?, priority=?, rate_limit_per_min=?, api_key_env=? WHERE key=?`
  ).run(
    body.enabled ?? !!cur.enabled,
    body.priority ?? cur.priority,
    body.rate_limit_per_min ?? cur.rate_limit_per_min,
    body.api_key_env ?? null,
    body.key
  );
  return NextResponse.json({ ok: true });
}
