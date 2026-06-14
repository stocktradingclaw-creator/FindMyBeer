import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, hasDb } from "@/lib/db";
import { lookupDetails, type DetailInput, type DetailsResult } from "@/lib/details";
import { tasteProfiles } from "@/lib/schema";
import { tasteSummary, type TasteProfile } from "@/lib/taste";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  let body: { beers?: unknown; taste?: unknown; location?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!Array.isArray(body.beers) || body.beers.length === 0) {
    return Response.json(
      { details: [], recommendation: null } satisfies DetailsResult,
      { status: 200 }
    );
  }
  const beers: DetailInput[] = body.beers.slice(0, 40).map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return {
      name: typeof o.name === "string" ? o.name.slice(0, 200) : "",
      brewery: typeof o.brewery === "string" ? o.brewery.slice(0, 200) : "",
      style: typeof o.style === "string" ? o.style.slice(0, 100) : "",
      price: typeof o.price === "number" ? o.price : null,
    };
  });

  let tasteText =
    typeof body.taste === "string" && body.taste.trim() ? body.taste.slice(0, 1500) : null;
  let locationText =
    typeof body.location === "string" && body.location.trim()
      ? body.location.slice(0, 100)
      : null;

  // Signed-in users: server-side profile is the source of truth.
  const session = await auth().catch(() => null);
  if (session?.user?.id && hasDb()) {
    const row = await db().query.tasteProfiles.findFirst({
      where: eq(tasteProfiles.userId, session.user.id),
    });
    if (row) {
      const profile: TasteProfile = {
        favoriteStyles: row.favoriteStyles,
        adventurousness: row.adventurousness as TasteProfile["adventurousness"],
        priceSensitivity: row.priceSensitivity as TasteProfile["priceSensitivity"],
        location: row.location,
        styleFeedback: row.styleFeedback,
      };
      tasteText = tasteSummary(profile).slice(0, 1500);
      locationText = row.location.trim() || null;
    }
  }

  try {
    const result = await lookupDetails(beers, tasteText, locationText);
    return Response.json(result);
  } catch (error) {
    console.error("Details lookup failed:", error);
    return Response.json({ error: "Couldn't load beer details." }, { status: 500 });
  }
}
