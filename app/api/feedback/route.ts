import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db, hasDb } from "@/lib/db";
import { tasteProfiles } from "@/lib/schema";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !hasDb()) {
    return Response.json({ error: "Sign in to record feedback." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const style = typeof body.style === "string" ? body.style.trim().slice(0, 60) : "";
  const delta = typeof body.delta === "number" ? Math.max(-2, Math.min(2, body.delta)) : 0;
  if (!style || delta === 0) {
    return Response.json({ error: "style and a non-zero delta are required." }, { status: 400 });
  }

  // Bump the style's net count inside the profile's styleFeedback JSON,
  // creating the profile row if this user doesn't have one yet.
  await db()
    .insert(tasteProfiles)
    .values({ userId: session.user.id, styleFeedback: { [style]: delta } })
    .onConflictDoUpdate({
      target: tasteProfiles.userId,
      set: {
        styleFeedback: sql`jsonb_set(
          ${tasteProfiles.styleFeedback},
          ARRAY[${style}::text],
          (COALESCE((${tasteProfiles.styleFeedback} ->> ${style})::int, 0) + ${delta})::text::jsonb
        )`,
        updatedAt: new Date(),
      },
    });

  return Response.json({ ok: true });
}
