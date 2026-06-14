import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { HistoryBeer } from "./history";

// --- Auth.js tables (standard Drizzle adapter shape) ---

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // Only set for email+password users; Google users have an account row instead.
  passwordHash: text("passwordHash"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// --- FindMyBeer tables ---

export const tasteProfiles = pgTable("taste_profile", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  favoriteStyles: jsonb("favoriteStyles").$type<string[]>().notNull().default([]),
  adventurousness: text("adventurousness").notNull().default("balanced"),
  priceSensitivity: text("priceSensitivity").notNull().default("medium"),
  location: text("location").notNull().default(""),
  styleFeedback: jsonb("styleFeedback")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const scans = pgTable("scan", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  thumb: text("thumb").notNull(),
  beers: jsonb("beers").$type<HistoryBeer[]>().notNull(),
});

// Shared across all users: one user's lookup benefits everyone.
export const ratingsCache = pgTable("ratings_cache", {
  key: text("key").primaryKey(),
  untappd: real("untappd"),
  beerAdvocate: real("beerAdvocate"),
  fetchedAt: timestamp("fetchedAt").notNull().defaultNow(),
});

// Consolidated review-commentary summaries, also shared across users.
export const commentaryCache = pgTable("commentary_cache", {
  key: text("key").primaryKey(),
  overview: text("overview").notNull(),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  found: boolean("found").notNull().default(true),
  fetchedAt: timestamp("fetchedAt").notNull().defaultNow(),
});
