import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy so the app (and `next build`) works before DATABASE_URL is configured —
// account features just stay disabled until then.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function db() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _db = drizzle(neon(url), { schema });
  }
  return _db;
}
