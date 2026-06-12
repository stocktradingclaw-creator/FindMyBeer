import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, hasDb } from "@/lib/db";
import { tasteProfiles } from "@/lib/schema";
import type { TasteProfile } from "@/lib/taste";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !hasDb()) {
    return Response.json({ profile: null });
  }
  const row = await db().query.tasteProfiles.findFirst({
    where: eq(tasteProfiles.userId, session.user.id),
  });
  if (!row) return Response.json({ profile: null });
  const profile: TasteProfile = {
    favoriteStyles: row.favoriteStyles,
    adventurousness: row.adventurousness as TasteProfile["adventurousness"],
    priceSensitivity: row.priceSensitivity as TasteProfile["priceSensitivity"],
    location: row.location,
    styleFeedback: row.styleFeedback,
  };
  return Response.json({ profile });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !hasDb()) {
    return Response.json({ error: "Sign in to save your profile." }, { status: 401 });
  }

  let body: Partial<TasteProfile>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const favoriteStyles = Array.isArray(body.favoriteStyles)
    ? body.favoriteStyles.filter((s): s is string => typeof s === "string").slice(0, 20)
    : [];
  const adventurousness = ["stick", "balanced", "explore"].includes(
    body.adventurousness as string
  )
    ? (body.adventurousness as string)
    : "balanced";
  const priceSensitivity = ["low", "medium", "high"].includes(
    body.priceSensitivity as string
  )
    ? (body.priceSensitivity as string)
    : "medium";
  const location =
    typeof body.location === "string" ? body.location.trim().slice(0, 100) : "";

  await db()
    .insert(tasteProfiles)
    .values({
      userId: session.user.id,
      favoriteStyles,
      adventurousness,
      priceSensitivity,
      location,
    })
    .onConflictDoUpdate({
      target: tasteProfiles.userId,
      set: { favoriteStyles, adventurousness, priceSensitivity, location, updatedAt: new Date() },
    });

  return Response.json({ ok: true });
}
