import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Vision + reasoning over a full shelf photo can take a while on Vercel.
export const maxDuration = 60;

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
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

const PROMPT = `This photo shows a beer shelf, fridge, or display. Identify every distinct beer (or cider/seltzer) whose label you can read or recognize.

For each distinct beer return one entry:
- name, brewery, and style from the label (or from your knowledge of the beer if the label is partially visible).
- rating: your best estimate of its enthusiast community score out of 5, the way BeerAdvocate or Untappd users rate it. Use null if you can't identify the beer well enough to estimate. These are estimates from your knowledge, so calibrate honestly rather than clustering everything at 4.
- ratingBasis: one short sentence (e.g. "Widely reviewed flagship IPA with a strong reputation").
- confidence in the identification.
- box: the approximate bounding box of one representative facing, in normalized 0-1 coordinates.

Deduplicate: multiple cans/bottles of the same beer get a single entry. If the photo contains no identifiable beers, return an empty array.`;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

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

    return Response.json(parsed);
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
