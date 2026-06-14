import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { blankDetails, type BeerDetails, type Recommendation } from "./types";

const DetailSchema = z.object({
  abv: z.number().nullable().describe("ABV percent (e.g. 6.2) from your knowledge; null if unknown"),
  colorHex: z
    .string()
    .nullable()
    .describe(
      "Hex approximating the beer's liquid color (pale straw ~#F4C430, amber ~#C8801E, brown ~#5A2D0C, black ~#140C06); null if unknown"
    ),
  flavor: z
    .object({
      hoppy: z.number().describe("0-5"),
      malty: z.number().describe("0-5"),
      bitter: z.number().describe("0-5"),
      body: z.number().describe("0-5"),
    })
    .nullable()
    .describe("Flavor profile each 0-5; null if unknown"),
  season: z
    .enum(["winter", "spring", "summer", "fall", "any"])
    .nullable()
    .describe("Season this beer suits best by style, or 'any' for year-round; null if unsure"),
  availability: z
    .enum(["common", "limited", "rare"])
    .nullable()
    .describe("common = widely distributed, limited = seasonal/limited, rare = sought-after whale"),
  breweryLocation: z
    .string()
    .nullable()
    .describe("Brewery's home city + state/country; null if unknown"),
  origin: z
    .enum(["local", "regional", "domestic", "international"])
    .nullable()
    .describe("Per the prompt's location rules; null if unknown"),
  rating: z
    .number()
    .nullable()
    .describe("Your 0-5 estimate of its community score, BeerAdvocate/Untappd style; null if unsure"),
  ratingBasis: z.string().describe("One short sentence on what the estimate is based on"),
});

const DetailsSchema = z.object({
  details: z.array(DetailSchema).describe("One entry per input beer, in the same order"),
  recommendation: z
    .object({
      index: z.number().describe("0-based position in the list of the single recommended beer"),
      reason: z
        .string()
        .describe("One or two friendly sentences to the drinker on why this is their pick"),
    })
    .nullable(),
});

export type DetailsResult = { details: BeerDetails[]; recommendation: Recommendation };

export type DetailInput = {
  name: string;
  brewery: string;
  style: string;
  price: number | null;
};

function seasonFor(date: Date): string {
  const month = date.getMonth();
  if (month === 11 || month <= 1) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "fall";
}

export async function lookupDetails(
  beers: DetailInput[],
  taste: string | null,
  location: string | null
): Promise<DetailsResult> {
  const today = new Date();
  const originRules = location
    ? `The drinker is in ${location}. Use the MOST specific bucket: "local" = same metro / within ~75 miles; "regional" = same or neighboring state; "domestic" = same country; "international" = a different country.`
    : `No drinker location given — use "domestic" vs "international" relative to the United States; never "local" or "regional".`;
  const list = beers
    .map(
      (b, i) =>
        `${i + 1}. "${b.name}" by ${b.brewery} (${b.style})${
          b.price !== null ? ` — $${b.price}` : ""
        }`
    )
    .join("\n");

  const prompt = `You are a knowledgeable beer expert. For each beer below, provide accurate attributes from your knowledge, then recommend one beer for the drinker.

${list}

For each beer (return them in the SAME order as the list), provide: abv, colorHex (its liquid color), flavor (hoppy/malty/bitter/body, each 0-5), season (best-fit season or "any"), availability (common/limited/rare), breweryLocation (city + state/country), origin (${originRules}), rating (your honest 0-5 estimate of its community score — calibrate rather than clustering at 4), and ratingBasis.

Today is ${today.toISOString().slice(0, 10)} — ${seasonFor(today)} in the northern hemisphere. Recommend exactly one beer via recommendation (index = 0-based position in the list above; null only if the list is empty). Weigh: fit with the drinker's taste below (the biggest factor when a profile is given), quality and reputation, seasonal fit, novelty matched to how adventurous they are, and price when given as one factor among several — never the sole deciding factor. Write the reason directly to the drinker.

Drinker's taste profile:
${taste ?? "Unknown — no profile set. Recommend the best overall beer for the season."}`;

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(DetailsSchema) },
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { details: beers.map(() => blankDetails()), recommendation: null };
  }

  // Align to the input length defensively.
  const details = beers.map((_, i) => response.parsed_output!.details[i] ?? blankDetails());
  const rec = response.parsed_output.recommendation;
  const recommendation =
    rec && rec.index >= 0 && rec.index < beers.length ? rec : null;
  return { details, recommendation };
}
