import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { IdentifiedBeer } from "@/lib/types";

// Vision identification only — knowledge attributes and live ratings are
// fetched separately (see /api/details and /api/ratings) so this returns fast.
export const maxDuration = 60;

const IdentifiedBeerSchema = z.object({
  name: z.string().describe("The beer's name as printed on the label"),
  brewery: z.string().describe("The brewery that makes it"),
  style: z.string().describe("Beer style, e.g. Hazy IPA, Imperial Stout"),
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

const IdentifySchema = z.object({ beers: z.array(IdentifiedBeerSchema) });

export type ScanResponse = { beers: IdentifiedBeer[] };

const PROMPT = `This photo shows a beer shelf, fridge, or display. Your only job is to identify what's on it — read the labels carefully.

Identify every distinct beer (or cider/seltzer) whose label you can read or recognize. For each one return:
- name, brewery, and style exactly as on the label (use your knowledge to complete a partially visible label only when you're confident which beer it is).
- confidence in the identification.
- price: the dollar amount from a shelf tag, but only when a tag is clearly visible and clearly belongs to this beer. Null otherwise.
- box: the approximate bounding box of one representative facing, in normalized 0-1 coordinates.

Deduplicate: multiple cans/bottles of the same beer get a single entry. Read carefully and don't invent beers that aren't there. If the photo contains no identifiable beers, return an empty array.`;

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
  try {
    ({ image } = await req.json());
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
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
            { type: "text", text: PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(IdentifySchema) },
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

    return Response.json({ beers: parsed.beers } satisfies ScanResponse);
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
