import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, hasDb } from "@/lib/db";
import { lookupLiveRatings, ratingKey, type LiveRating } from "@/lib/ratings";
import { tasteProfiles } from "@/lib/schema";
import { tasteSummary, type TasteProfile } from "@/lib/taste";

// Vision pass + web-search rating lookup can take a while on Vercel.
export const maxDuration = 120;

const BeerSchema = z.object({
  name: z.string().describe("The beer's name as printed on the label"),
  brewery: z.string().describe("The brewery that makes it"),
  style: z.string().describe("Beer style, e.g. Hazy IPA, Imperial Stout"),
  rating: z
    .number()
    .nullable()
    .describe(
      "Approximate enthusiast rating out of 5, in the style of BeerAdvocate/Untappd community scores. Null if the beer is not recognized well enough to estimate."
    ),
  ratingBasis: z
    .string()
    .describe("One short sentence on what the rating estimate is based on"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high = label clearly legible and beer well known; medium = label partially legible or beer less known; low = a guess"
    ),
  price: z
    .number()
    .nullable()
    .describe(
      "Shelf price in dollars if a price tag is clearly visible and attributable to this beer, else null"
    ),
  breweryLocation: z
    .string()
    .nullable()
    .describe("The brewery's home city and state/country from your knowledge, else null"),
  origin: z
    .enum(["local", "regional", "domestic", "international"])
    .nullable()
    .describe(
      "Most specific bucket relative to the drinker's location, per the prompt's rules; null if unknown"
    ),
  box: z
    .object({
      x: z.number().describe("Left edge as a fraction of image width, 0-1"),
      y: z.number().describe("Top edge as a fraction of image height, 0-1"),
      w: z.number().describe("Width as a fraction of image width, 0-1"),
      h: z.number().describe("Height as a fraction of image height, 0-1"),
    })
    .nullable()
    .describe(
      "Approximate bounding box of one representative facing of this beer, or null if location is unclear"
    ),
});

const ScanResultSchema = z.object({
  beers: z.array(BeerSchema),
  recommendation: z
    .object({
      index: z
        .number()
        .describe("0-based index into the beers array of the single recommended beer"),
      reason: z
        .string()
        .describe(
          "One or two friendly sentences addressed to the drinker explaining why this is their pick today"
        ),
    })
    .nullable()
    .describe("The one beer to recommend to this drinker right now; null if no beers found"),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

export type ScanBeer = ScanResult["beers"][number] & {
  ratingSource: "live" | "estimate";
  // Per-site live scores (out of 5); null when not found or not looked up.
  // When live, `rating` is the consolidated score: the average of these.
  untappd: number | null;
  beerAdvocate: number | null;
};

export type ScanResponse = {
  beers: ScanBeer[];
  recommendation: { index: number; reason: string } | null;
};

function seasonFor(date: Date): string {
  const month = date.getMonth();
  if (month === 11 || month <= 1) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "fall";
}

function buildPrompt(taste: string | null, location: string | null): string {
  const today = new Date();
  const originRules = location
    ? `The drinker is in ${location}. Classify into the MOST specific bucket that applies: "local" = brewed in roughly the same metro area or within ~75 miles; "regional" = same state or a neighboring state; "domestic" = same country; "international" = a different country.`
    : `No drinker location was given. Use "domestic" vs "international" relative to the country this store appears to be in (assume the United States if unclear); never use "local" or "regional".`;
  return `This photo shows a beer shelf, fridge, or display. Identify every distinct beer (or cider/seltzer) whose label you can read or recognize.

For each distinct beer return one entry:
- name, brewery, and style from the label (or from your knowledge of the beer if the label is partially visible).
- rating: your best estimate of its enthusiast community score out of 5, the way BeerAdvocate or Untappd users rate it. Use null if you can't identify the beer well enough to estimate. These are estimates from your knowledge, so calibrate honestly rather than clustering everything at 4.
- ratingBasis: one short sentence (e.g. "Widely reviewed flagship IPA with a strong reputation").
- confidence in the identification.
- price: the dollar price from a shelf tag, but only when a tag is clearly visible and clearly belongs to this beer. Null otherwise.
- breweryLocation: the brewery's home city and state/country, from your knowledge. Null if you don't know the brewery.
- origin: ${originRules} Null when the brewery's location is unknown.
- box: the approximate bounding box of one representative facing, in normalized 0-1 coordinates.

Deduplicate: multiple cans/bottles of the same beer get a single entry. If the photo contains no identifiable beers, return an empty array.

Then choose exactly ONE beer to recommend via the recommendation field (null only if no beers were found). Today is ${today.toISOString().slice(0, 10)} — ${seasonFor(today)} in the northern hemisphere. Weigh together:
- fit with the drinker's tastes below (the biggest factor when a profile is given);
- quality and community standing;
- seasonal fit (rich, dark, warming beers in winter; crisp, refreshing ones in summer; märzen/amber in fall; and seasonal releases when they fit);
- novelty, matched to how adventurous the drinker says they are — an interesting departure they'd plausibly enjoy can beat a safe favorite;
- price when visible, as one factor among several — never the deciding factor on its own.
Write the reason directly to the drinker, mentioning what tipped the choice.

Drinker's taste profile:
${taste ?? "Unknown — no profile set. Recommend the best overall beer for the season."}`;
}

type MediaType = "image/jpeg" | "image/png" | "image/webp";

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "Server is missing ANTHROPIC_API_KEY. Copy .env.example to .env.local and add your key.",
      },
      { status: 500 }
    );
  }

  let image: unknown;
  let taste: unknown;
  let location: unknown;
  try {
    ({ image, taste, location } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  let tasteText =
    typeof taste === "string" && taste.trim() ? taste.slice(0, 1500) : null;
  let locationText =
    typeof location === "string" && location.trim() ? location.slice(0, 100) : null;

  // Signed-in users: their server-side profile is the source of truth,
  // overriding whatever the client sent.
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

  const match =
    typeof image === "string"
      ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image)
      : null;
  if (!match) {
    return Response.json(
      { error: "Expected { image: <data URL> } with a JPEG, PNG, or WebP image." },
      { status: 400 }
    );
  }
  const mediaType = match[1] as MediaType;
  const data = match[2];

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data },
            },
            { type: "text", text: buildPrompt(tasteText, locationText) },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ScanResultSchema) },
    });

    if (response.stop_reason === "refusal") {
      return Response.json(
        { error: "The image couldn't be analyzed. Try a different photo." },
        { status: 422 }
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      return Response.json(
        { error: "Couldn't read the shelf from that photo. Try again with better lighting." },
        { status: 502 }
      );
    }

    // Best-effort upgrade from knowledge-based estimates to real, current
    // community scores found via web search (cached per beer). Low-confidence
    // identifications aren't worth a search. The lookup is time-boxed: past
    // the deadline the scan responds with estimates while the lookup keeps
    // running and fills the cache for the next scan. (On serverless hosts the
    // background half may be frozen after the response is sent.)
    const candidates = parsed.beers
      .filter((b) => b.confidence !== "low")
      .map(({ name, brewery }) => ({ name, brewery }));
    let live = new Map<string, LiveRating>();
    if (candidates.length > 0) {
      const t0 = Date.now();
      const lookup = lookupLiveRatings(candidates);
      lookup
        .then((m) => console.log(`scan: rating lookup finished in ${Date.now() - t0}ms (${m.size} beers)`))
        .catch((err) => console.error("scan: rating lookup failed:", err));
      live = await Promise.race([
        lookup.catch(() => new Map<string, LiveRating>()),
        new Promise<Map<string, LiveRating>>((resolve) =>
          setTimeout(() => resolve(new Map()), 75_000)
        ),
      ]);
      if (live.size === 0) {
        console.log(`scan: serving estimates (lookup not ready after ${Date.now() - t0}ms)`);
      }
    }

    const beers: ScanBeer[] = parsed.beers.map((beer) => {
      const found = live.get(ratingKey(beer.name, beer.brewery));
      const scores = [found?.untappd, found?.beerAdvocate].filter(
        (s): s is number => typeof s === "number"
      );
      if (found && scores.length > 0) {
        const consolidated =
          Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
        return {
          ...beer,
          rating: consolidated,
          untappd: found.untappd,
          beerAdvocate: found.beerAdvocate,
          ratingBasis: "Consolidated from live site scores",
          ratingSource: "live",
        };
      }
      return { ...beer, untappd: null, beerAdvocate: null, ratingSource: "estimate" };
    });

    const recommendation =
      parsed.recommendation &&
      parsed.recommendation.index >= 0 &&
      parsed.recommendation.index < beers.length
        ? parsed.recommendation
        : null;

    return Response.json({ beers, recommendation } satisfies ScanResponse);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY is invalid. Check .env.local." },
        { status: 500 }
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json(
        { error: "Rate limited — wait a moment and scan again." },
        { status: 429 }
      );
    }
    console.error("Scan failed:", error);
    return Response.json({ error: "Scan failed. Try again." }, { status: 500 });
  }
}
