import { NextRequest, NextResponse } from "next/server";
import { resolvePhone, searchLocal } from "@/lib/aggregator";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/phones/search?q=iPhone 17 Pro Max[&gsm=realme_8-10810]
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  const gsm = req.nextUrl.searchParams.get("gsm")?.trim() || undefined;

  // Fast path: local cache hit (only when we have no exact identity)
  const local = !gsm ? searchLocal(q) : [];
  if (local.length === 1) {
    try {
      const { phone, fromCache } = await resolvePhone(q);
      return NextResponse.json({ phone, fromCache });
    } catch {
      return NextResponse.json({ results: local.map((p) => ({ ...p, fields: {} })) });
    }
  }

  try {
    const { phone, fromCache } = await resolvePhone(q, { gsmSlug: gsm });
    return NextResponse.json({ phone, fromCache });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lookup failed", results: local },
      { status }
    );
  }
}
