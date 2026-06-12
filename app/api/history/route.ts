import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, hasDb } from "@/lib/db";
import { scans } from "@/lib/schema";
import type { HistoryEntry } from "@/lib/history";

const MAX_ENTRIES = 30;

// Stored verbatim and rendered back later, so every element is shape-checked
// (zod also strips unknown keys).
const HistoryBeerSchema = z.object({
  name: z.string().min(1).max(200),
  brewery: z.string().max(200),
  style: z.string().max(100),
  rating: z.number().min(0).max(5).nullable(),
  untappd: z.number().min(0).max(5).nullable(),
  beerAdvocate: z.number().min(0).max(5).nullable(),
  ratingSource: z.enum(["live", "estimate"]),
  price: z.number().min(0).max(100_000).nullable(),
});

const HistoryPostSchema = z.object({
  thumb: z.string().startsWith("data:image/").max(100_000),
  beers: z.array(HistoryBeerSchema).min(1).max(50),
});

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = HistoryPostSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "thumb (image data URL) and a valid beers array are required." },
      { status: 400 }
    );
  }

  await db().insert(scans).values({
    userId: session.user.id,
    thumb: parsed.data.thumb,
    beers: parsed.data.beers,
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
