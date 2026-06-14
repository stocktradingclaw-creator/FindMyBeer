import { lookupLiveRatings, ratingKey } from "@/lib/ratings";
import type { LiveScores } from "@/lib/types";

// Web-search ratings lookup — the slow phase, fetched in parallel with details.
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY." }, { status: 500 });
  }

  let body: { beers?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!Array.isArray(body.beers) || body.beers.length === 0) {
    return Response.json({ ratings: [] });
  }

  const beers = body.beers.slice(0, 40).map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return {
      name: typeof o.name === "string" ? o.name.slice(0, 200) : "",
      brewery: typeof o.brewery === "string" ? o.brewery.slice(0, 200) : "",
    };
  });

  try {
    const map = await lookupLiveRatings(beers);
    const ratings: (LiveScores | null)[] = beers.map((b) => {
      const hit = map.get(ratingKey(b.name, b.brewery));
      return hit ? { untappd: hit.untappd, beerAdvocate: hit.beerAdvocate } : null;
    });
    return Response.json({ ratings });
  } catch (error) {
    console.error("Ratings lookup failed:", error);
    return Response.json({ error: "Couldn't load live ratings." }, { status: 500 });
  }
}
