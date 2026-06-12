import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, hasDb } from "@/lib/db";
import { scans } from "@/lib/schema";
import type { HistoryBeer, HistoryEntry } from "@/lib/history";

const MAX_ENTRIES = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !hasDb()) {
    return Response.json({ entries: null });
  }
  const rows = await db()
    .select()
    .from(scans)
    .where(eq(scans.userId, session.user.id))
    .orderBy(desc(scans.createdAt))
    .limit(MAX_ENTRIES);
  const entries: HistoryEntry[] = rows.map((row) => ({
    ts: row.createdAt.getTime(),
    thumb: row.thumb,
    beers: row.beers,
  }));
  return Response.json({ entries });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !hasDb()) {
    return Response.json({ error: "Sign in to save history." }, { status: 401 });
  }

  let body: { thumb?: unknown; beers?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const thumb =
    typeof body.thumb === "string" && body.thumb.startsWith("data:image/")
      ? body.thumb.slice(0, 100_000)
      : null;
  if (!thumb || !Array.isArray(body.beers) || body.beers.length === 0) {
    return Response.json({ error: "thumb and beers are required." }, { status: 400 });
  }

  await db()
    .insert(scans)
    .values({
      userId: session.user.id,
      thumb,
      beers: body.beers.slice(0, 50) as HistoryBeer[],
    });

  return Response.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id || !hasDb()) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  await db().delete(scans).where(eq(scans.userId, session.user.id));
  return Response.json({ ok: true });
}
