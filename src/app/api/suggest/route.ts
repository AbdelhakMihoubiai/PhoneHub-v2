import { NextRequest, NextResponse } from "next/server";
import { suggestPhones } from "@/lib/providers/gsmarena-mobile";

export const runtime = "nodejs";

// GET /api/suggest?q=realme — live phone suggestions (GSMArena index, cached)
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ suggestions: [] });
  const suggestions = await suggestPhones(q, 8);
  return NextResponse.json({ suggestions });
}
