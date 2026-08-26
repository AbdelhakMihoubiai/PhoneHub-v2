import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getPhoneByIdOrSlug } from "@/lib/aggregator";

export const runtime = "nodejs";

// GET /api/phones/[id] — full record with sourced fields
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const phone = getPhoneByIdOrSlug(id);
  if (!phone) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pid = phone.id;
  const benchmarks = db.prepare("SELECT * FROM benchmarks WHERE phone_id = ?").all(pid);
  const gaming = db.prepare("SELECT * FROM gaming_results WHERE phone_id = ?").all(pid);
  const prices = db.prepare("SELECT * FROM prices WHERE phone_id = ?").all(pid);
  const media = db.prepare("SELECT kind, title, url, image_url FROM media WHERE phone_id = ?").all(pid);
  const history = db
    .prepare("SELECT entity, key, old_value, new_value, source, retrieved_at FROM update_history WHERE phone_id = ? ORDER BY retrieved_at DESC LIMIT 100")
    .all(pid);

  return NextResponse.json({ phone, benchmarks, gaming, prices, media, history });
}
