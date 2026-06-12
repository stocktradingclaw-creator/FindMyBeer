# FindMyBeer 🍺

Point your camera at a beer shelf and find out what's worth drinking.

FindMyBeer is a [Next.js](https://nextjs.org) web app: snap a photo (or use the
live camera) of a shelf or fridge, and it identifies each beer and overlays an
approximate community rating (BeerAdvocate/Untappd style) on the image, with
the top pick highlighted.

## How it works

- The `/scan` page opens your camera (rear camera on phones) or accepts an
  uploaded photo, downscales it client-side, and sends it to `/api/scan`.
- The API route sends the image to **Claude (Opus 4.8)** with vision and a
  structured-output schema. The model identifies each beer, reads visible
  price tags, and returns a normalized bounding box per beer.
- Each newly seen beer gets its real community score looked up via Claude's
  web-search tool (~1¢ per search) and cached in `.ratings-cache.json`, so
  repeat scans are instant and free. The lookup is time-boxed: if it isn't
  done in 75s the scan responds with knowledge-based estimates (labeled
  "est.") while the search finishes in the background and fills the cache.
- The UI draws rating badges over the captured frame, lists the beers
  best-first with per-site scores (★ is the consolidated average of the
  Untappd and BeerAdvocate scores), live/est labels and prices, and tags
  the best rating-per-dollar pick with a 💰 badge. Scans are saved to a
  local history page (`/history`, stored only on the device).
- A taste profile (`/taste`: favorite styles, adventurousness, price
  sensitivity, your location) plus 👍/👎 feedback on scanned beers — all
  on-device — feeds every scan, and the model returns a 🎯 personal pick
  that weighs taste fit, quality, seasonal fit, novelty, and price (price
  never deciding alone).
- Each beer is tagged with its brewery's home and an origin bucket
  relative to your location — filter results by Local, Regional,
  Domestic, or International (tiers nest: local counts as regional and
  domestic).

> **Why not the Untappd API?** It's closed to new applications; the only
> current option is an Untappd for Business subscription. Web search of
> public score pages plus caching covers the same need for ~1¢ per
> never-before-seen beer.

## Accounts

Sign-up (`/signup`) and sign-in (`/login`) are powered by Auth.js (email +
password, plus Google when configured) with user data in Neon Postgres:
taste profiles, 👍/👎 style feedback, and scan history are stored per user
and follow them across devices; the scan API resolves the signed-in user's
profile server-side. The beer-ratings cache is shared across all users.
Signed-out visitors get the full app with on-device storage instead.

Setup (one time):

1. Create a free Postgres database at [neon.tech](https://neon.tech), copy
   the connection string into `DATABASE_URL` in `.env.local`.
2. `npm run db:push` to create the tables.
3. Optional Google sign-in: create OAuth credentials at
   [console.cloud.google.com](https://console.cloud.google.com) (redirect
   URI: `<your-origin>/api/auth/callback/google`) and set
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The button appears
   automatically when both are set.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values (see Accounts above)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and hit **Scan a shelf**.

Note: browsers only allow camera access on `localhost` or HTTPS. To test the
live camera from a phone, deploy the app or tunnel with HTTPS; photo upload
works everywhere.

## Scripts

- `npm run dev` — start the dev server (Turbopack)
- `npm run build` — production build
- `npm start` — serve the production build
- `npm run lint` — run ESLint

## Stack

- [Next.js](https://nextjs.org) (App Router) + React
- TypeScript
- [Tailwind CSS](https://tailwindcss.com)
- [Anthropic SDK](https://platform.claude.com) — vision + structured outputs
