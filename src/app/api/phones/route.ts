import { NextResponse } from "next/server";
import db from "@/lib/db";

export const runtime = "nodejs";

// GET /api/phones — browse the cached database
export async function GET() {
  const rows = db.prepare(
    "SELECT id, slug, brand, model, image_url, release_date, updated_at FROM phones ORDER BY updated_at DESC LIMIT 100"
  ).all();
  return NextResponse.json({
    phones: rows,
    count: (db.prepare("SELECT COUNT(*) AS c FROM phones").get() as { c: number }).c,
  });
}
