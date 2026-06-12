import Anthropic from "@anthropic-ai/sdk";
import { inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db, hasDb } from "./db";
import { ratingsCache } from "./schema";

export type LiveRating = {
  untappd: number | null; // out of 5; null = looked up but not found
  beerAdvocate: number | null; // out of 5; null = looked up but not found
  fetchedAt: number;
};

// The cache lives in Postgres when a database is configured (shared across
// all users — one user's lookup benefits everyone). Without a database it
// falls back to a local JSON file, which only persists on a real machine.
const CACHE_PATH = path.join(process.cwd(), ".ratings-cache.json");
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Not-found results retry much sooner — a miss may just be a flaky search.
const NULL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SEARCHES_PER_SCAN = 8;

export function ratingKey(name: string, brewery: string): string {
  return `${brewery.trim().toLowerCase()}|${name.trim().toLowerCase()}`;
}

async function loadCachedRatings(keys: string[]): Promise<Record<string, LiveRating>> {
  if (keys.length === 0) return {};
  if (hasDb()) {
    const rows = await db()
      .select()
      .from(ratingsCache)
      .where(inArray(ratingsCache.key, keys));
    return Object.fromEntries(
      rows.map((row) => [
        row.key,
        {
          untappd: row.untappd,
          beerAdvocate: row.beerAdvocate,
          fetchedAt: row.fetchedAt.getTime(),
        },
      ])
    );
  }
  try {
    const file = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    const out: Record<string, LiveRating> = {};
    for (const key of keys) {
      const hit = file[key];
      if (hit && "untappd" in hit && "beerAdvocate" in hit) out[key] = hit;
    }
    return out;
  } catch {
    return {};
  }
}

async function saveCachedRatings(entries: Record<string, LiveRating>): Promise<void> {
  try {
    if (hasDb()) {
      for (const [key, entry] of Object.entries(entries)) {
        await db()
          .insert(ratingsCache)
          .values({
            key,
            untappd: entry.untappd,
            beerAdvocate: entry.beerAdvocate,
            fetchedAt: new Date(entry.fetchedAt),
          })
          .onConflictDoUpdate({
            target: ratingsCache.key,
            set: {
              untappd: entry.untappd,
              beerAdvocate: entry.beerAdvocate,
              fetchedAt: new Date(entry.fetchedAt),
            },
          });
      }
      return;
    }
    let file: Record<string, LiveRating> = {};
    try {
      file = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    } catch {
      /* fresh file */
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ ...file, ...entries }, null, 2));
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
  const unique = new Map<string, { name: string; brewery: string }>();
  for (const beer of beers) {
    unique.set(ratingKey(beer.name, beer.brewery), beer);
  }
  const cache = await loadCachedRatings([...unique.keys()]);
  const result = new Map<string, LiveRating>();
  const misses: { name: string; brewery: string }[] = [];

  for (const [key, beer] of unique) {
    const hit = cache[key];
    const notFound = hit?.untappd === null && hit?.beerAdvocate === null;
    const ttl = notFound ? NULL_TTL_MS : TTL_MS;
    if (hit && Date.now() - hit.fetchedAt < ttl) {
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
  const fresh: Record<string, LiveRating> = {};
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
    fresh[key] = entry;
    result.set(key, entry);
  }
  await saveCachedRatings(fresh);
  return result;
}
