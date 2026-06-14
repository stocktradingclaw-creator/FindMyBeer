// Shared types across the three scan phases. Pure types only — safe to import
// from client components (no server-only dependencies).

export type Box = { x: number; y: number; w: number; h: number };
export type Flavor = { hoppy: number; malty: number; bitter: number; body: number };
export type Season = "winter" | "spring" | "summer" | "fall" | "any";
export type Availability = "common" | "limited" | "rare";
export type Origin = "local" | "regional" | "domestic" | "international";

// Phase 1 — vision identification (what's on the shelf and where).
export type IdentifiedBeer = {
  name: string;
  brewery: string;
  style: string;
  confidence: "high" | "medium" | "low";
  price: number | null;
  box: Box | null;
};

// Phase 2 — knowledge attributes (no image needed).
export type BeerDetails = {
  abv: number | null;
  colorHex: string | null;
  flavor: Flavor | null;
  season: Season | null;
  availability: Availability | null;
  breweryLocation: string | null;
  origin: Origin | null;
  rating: number | null; // knowledge-based estimate, 0-5
  ratingBasis: string;
};

export type Recommendation = { index: number; reason: string } | null;

// Phase 3 — live community scores.
export type LiveScores = { untappd: number | null; beerAdvocate: number | null };

// Merged shape the UI renders, filled progressively across the three phases.
export type ScanBeer = IdentifiedBeer &
  BeerDetails & {
    untappd: number | null;
    beerAdvocate: number | null;
    ratingSource: "live" | "estimate";
    detailsLoaded: boolean;
  };

export function blankDetails(): BeerDetails {
  return {
    abv: null,
    colorHex: null,
    flavor: null,
    season: null,
    availability: null,
    breweryLocation: null,
    origin: null,
    rating: null,
    ratingBasis: "",
  };
}
