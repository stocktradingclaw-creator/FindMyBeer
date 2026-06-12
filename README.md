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
  structured-output schema. The model identifies each beer, estimates its
  rating out of 5, and returns a normalized bounding box per beer.
- The UI draws rating badges over the captured frame and lists the beers
  sorted best-first.

> **Honesty note:** ratings are AI estimates of community scores from the
> model's knowledge — BeerAdvocate has no public API. Treat them as a guide.
> Wiring in live rating data (e.g. the Untappd API) is a natural next step.

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
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
