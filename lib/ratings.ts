import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

export type LiveRating = {
  untappd: number | null; // out of 5; null = looked up but not found
  beerAdvocate: number | null; // out of 5; null = looked up but not found
  fetchedAt: number;
};

// Local JSON cache so each beer is only ever searched once (per TTL).
// Note: on serverless hosts the filesystem is ephemeral, so this cache only
// persists when running on a real machine.
const CACHE_PATH = path.join(process.cwd(), ".ratings-cache.json");
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Not-found results retry much sooner — a miss may just be a flaky search.
const NULL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SEARCHES_PER_SCAN = 8;

export function ratingKey(name: string, brewery: string): string {
  return `${brewery.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
}

function loadCache(): Record<string, LiveRating> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, LiveRating>) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("Couldn't persist ratings cache:", err);
  }
}

function extractJsonArray(text: string): unknown[] | null {
  // The model is asked to end with a fenced ```json block; take the last one.
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const candidate = fenced.length
    ? fenced[fenced.length - 1][1]
    : text.slice(text.lastIndexOf("["));
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function lookupLiveRatings(
  beers: { name: string; brewery: string }[]
): Promise<Map<string, LiveRating>> {
  const cache = loadCache();
  const result = new Map<string, LiveRating>();
  const misses: { name: string; brewery: string }[] = [];
  const seen = new Set<string>();

  for (const beer of beers) {
    const key = ratingKey(beer.name, beer.brewery);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = cache[key];
    // Entries from the old single-score cache shape count as misses.
    const validShape = hit && "untappd" in hit && "beerAdvocate" in hit;
    const notFound = hit?.untappd === null && hit?.beerAdvocate === null;
    const ttl = notFound ? NULL_TTL_MS : TTL_MS;
    if (validShape && Date.now() - hit.fetchedAt < ttl) {
      result.set(key, hit);
    } else {
      misses.push(beer);
    }
  }
  if (misses.length === 0) return result;

  const list = misses
    .map((b, i) => `${i + 1}. "${b.name}" by ${b.brewery}`)
    .join("\n");
  const prompt = `Look up the current community ratings for each of these beers:
${list}

For each beer find BOTH of these scores when available (both sites rate out of 5):
- its Untappd community score
- its BeerAdvocate community score

A single search like "<beer name> untappd beeradvocate rating" often surfaces both sites at once, so use as few searches as you can. If a couple of attempts don't surface a credible score from one of the sites, report null for that score rather than continuing to search.

End your reply with exactly one fenced \`\`\`json block: an array with one object per beer, in the same order as the list above, shaped as {"index": <1-based list number>, "untappd": <number or null>, "beerAdvocate": <number or null>}.`;

  const client = new Anthropic();
  let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const request = {
    model: "claude-opus-4-8",
    max_tokens: 16000,
    tools: [
      {
        type: "web_search_20260209" as const,
        name: "web_search" as const,
        max_uses: Math.min(misses.length * 2, MAX_SEARCHES_PER_SCAN),
      },
    ],
  };

  let response = await client.messages.create({ ...request, messages });
  // Server-side tool loops can pause; re-send to let the server resume.
  for (let i = 0; response.stop_reason === "pause_turn" && i < 3; i++) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await client.messages.create({ ...request, messages });
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const rows = extractJsonArray(text) ?? [];

  const asScore = (value: unknown): number | null =>
    typeof value === "number" && value >= 0 && value <= 5
      ? Math.round(value * 10) / 10
      : null;

  const now = Date.now();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { index, untappd, beerAdvocate } = row as Record<string, unknown>;
    const beer = typeof index === "number" ? misses[index - 1] : undefined;
    if (!beer) continue;
    const entry: LiveRating = {
      untappd: asScore(untappd),
      beerAdvocate: asScore(beerAdvocate),
      fetchedAt: now,
    };
    const key = ratingKey(beer.name, beer.brewery);
    cache[key] = entry;
    result.set(key, entry);
  }
  saveCache(cache);
  return result;
}
