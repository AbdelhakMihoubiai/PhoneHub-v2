import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { refreshPhone } from "@/lib/aggregator";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/phones/refresh — refresh all cached phones (or ?q= for one query)
export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (q) {
    try {
      const phone = await refreshPhone(q);
      return NextResponse.json({ ok: true, refreshed: [phone.slug] });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Refresh failed" },
        { status: 502 }
      );
    }
  }

  const rows = db.prepare("SELECT id FROM phones").all() as Array<{ id: number }>;
  const refreshed: string[] = [];
  const failed: Array<{ id: number; error: string }> = [];
  for (const r of rows) {
    try {
      const p = await refreshPhone(String(r.id));
      refreshed.push(p.slug);
    } catch (e) {
      failed.push({ id: r.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, refreshed, failed });
}
