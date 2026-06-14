import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db, hasDb } from "./db";
import { ratingKey } from "./ratings";
import { commentaryCache } from "./schema";

export type Commentary = {
  overview: string;
  notes: string[];
  found: boolean;
  fetchedAt: number;
};

const CACHE_PATH = path.join(process.cwd(), ".commentary-cache.json");
const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000; // retry not-found sooner

async function loadCached(key: string): Promise<Commentary | null> {
  if (hasDb()) {
    const row = await db().query.commentaryCache.findFirst({
      where: eq(commentaryCache.key, key),
    });
    return row
      ? {
          overview: row.overview,
          notes: row.notes,
          found: row.found,
          fetchedAt: row.fetchedAt.getTime(),
        }
      : null;
  }
  try {
    const file = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return file[key] ?? null;
  } catch {
    return null;
  }
}

async function saveCached(key: string, c: Commentary): Promise<void> {
  try {
    if (hasDb()) {
      await db()
        .insert(commentaryCache)
        .values({
          key,
          overview: c.overview,
          notes: c.notes,
          found: c.found,
          fetchedAt: new Date(c.fetchedAt),
        })
        .onConflictDoUpdate({
          target: commentaryCache.key,
          set: {
            overview: c.overview,
            notes: c.notes,
            found: c.found,
            fetchedAt: new Date(c.fetchedAt),
          },
        });
      return;
    }
    let file: Record<string, Commentary> = {};
    try {
      file = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    } catch {
      /* fresh file */
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ ...file, [key]: c }, null, 2));
  } catch (err) {
    console.error("Couldn't persist commentary cache:", err);
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const candidate = fenced.length
    ? fenced[fenced.length - 1][1]
    : text.slice(text.lastIndexOf("{"));
  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export async function lookupCommentary(
  name: string,
  brewery: string
): Promise<Commentary> {
  const key = ratingKey(name, brewery);
  const hit = await loadCached(key);
  if (hit) {
    const ttl = hit.found ? FOUND_TTL_MS : MISS_TTL_MS;
    if (Date.now() - hit.fetchedAt < ttl) return hit;
  }

  const prompt = `Summarize what beer reviewers say about "${name}" by ${brewery}.

Search Untappd and BeerAdvocate (and other beer-review sources if helpful) for reviews of this specific beer, then write a concise consolidated summary of the community's commentary:
- overview: 2-3 plain sentences capturing the overall impression — flavor profile, what people praise, common criticisms, and the general consensus.
- notes: 3-5 very short bullet points (recurring tasting notes or opinions), each just a few words.

Base everything on actual reviews you find. If you genuinely can't find reviews for this specific beer, set found to false, put a brief note in overview that there isn't enough review data, and leave notes empty.

End your reply with exactly one fenced \`\`\`json block shaped as {"found": <true|false>, "overview": "<text>", "notes": ["<short>", ...]}.`;

  const client = new Anthropic();
  const request = {
    model: "claude-opus-4-8",
    max_tokens: 16000,
    tools: [
      { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 4 },
    ],
  };
  let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  let response = await client.messages.create({ ...request, messages });
  for (let i = 0; response.stop_reason === "pause_turn" && i < 4; i++) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await client.messages.create({ ...request, messages });
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const obj = extractJsonObject(text);

  const result: Commentary = {
    found: obj?.found === true,
    overview:
      typeof obj?.overview === "string"
        ? obj.overview.slice(0, 800)
        : "Couldn't pull together reviews for this beer right now.",
    notes: Array.isArray(obj?.notes)
      ? obj.notes.filter((n): n is string => typeof n === "string").slice(0, 6)
      : [],
    fetchedAt: Date.now(),
  };
  await saveCached(key, result);
  return result;
}
