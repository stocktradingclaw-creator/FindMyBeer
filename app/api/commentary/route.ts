import { lookupCommentary } from "@/lib/commentary";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server is missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  let body: { name?: unknown; brewery?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const brewery =
    typeof body.brewery === "string" ? body.brewery.trim().slice(0, 200) : "";
  if (!name) {
    return Response.json({ error: "A beer name is required." }, { status: 400 });
  }

  try {
    const commentary = await lookupCommentary(name, brewery);
    return Response.json(commentary);
  } catch (error) {
    console.error("Commentary lookup failed:", error);
    return Response.json(
      { error: "Couldn't load reviews — try again." },
      { status: 500 }
    );
  }
}
