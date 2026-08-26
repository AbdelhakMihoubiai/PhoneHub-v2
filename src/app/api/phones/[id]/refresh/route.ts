import { NextRequest, NextResponse } from "next/server";
import { refreshPhone } from "@/lib/aggregator";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/phones/[id]/refresh — re-query providers and update changed fields
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const phone = await refreshPhone(id);
    return NextResponse.json({ ok: true, phone });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 502 }
    );
  }
}
