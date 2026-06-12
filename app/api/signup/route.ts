import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, hasDb } from "@/lib/db";
import { users } from "@/lib/schema";

export async function POST(req: Request) {
  if (!hasDb()) {
    return Response.json(
      { error: "Accounts aren't set up yet on this server (no database configured)." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 255) : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name) return Response.json({ error: "Name is required." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const existing = await db().query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    return Response.json(
      { error: "An account with that email already exists — try signing in." },
      { status: 409 }
    );
  }

  await db()
    .insert(users)
    .values({ name, email, passwordHash: await bcrypt.hash(password, 10) });

  return Response.json({ ok: true });
}
