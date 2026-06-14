// On-device taste profile: a one-time quiz plus thumbs feedback that
// accumulates over time. Lives in localStorage; sent to the scan API as a
// plain-text summary so the model can personalize its recommendation.

export const BEER_STYLES = [
  "IPA",
  "Hazy IPA",
  "Pale Ale",
  "Lager / Pilsner",
  "Stout / Porter",
  "Sour / Gose",
  "Wheat / Hefeweizen",
  "Belgian",
  "Amber / Red Ale",
  "Cider / Seltzer",
] as const;

export type TasteProfile = {
  favoriteStyles: string[];
  adventurousness: "stick" | "balanced" | "explore";
  priceSensitivity: "low" | "medium" | "high";
  location?: string; // e.g. "Denver, CO" — used to classify beer origins
  styleFeedback: Record<string, number>; // style -> net thumbs over time
};

const KEY = "findmybeer-taste";

export function loadTaste(): TasteProfile | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return parsed && Array.isArray(parsed.favoriteStyles) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveTaste(profile: TasteProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* profile is a nice-to-have; never break the app over it */
  }
}

export function recordStyleFeedback(style: string, delta: number): void {
  const profile = loadTaste() ?? {
    favoriteStyles: [],
    adventurousness: "balanced" as const,
    priceSensitivity: "medium" as const,
    styleFeedback: {},
  };
  profile.styleFeedback[style] = (profile.styleFeedback[style] ?? 0) + delta;
  saveTaste(profile);
}

const ADVENTURE_TEXT: Record<TasteProfile["adventurousness"], string> = {
  stick: "prefers staying close to their favorite styles",
  balanced:
    "mostly likes their favorite styles but is open to an occasional interesting departure",
  explore:
    "loves being surprised — actively enjoys interesting beers outside their usual styles",
};

export function tasteSummary(profile: TasteProfile): string {
  const lines: string[] = [];
  if (profile.favoriteStyles.length > 0) {
    lines.push(`Favorite styles: ${profile.favoriteStyles.join(", ")}.`);
  }
  lines.push(`Openness to new styles: ${ADVENTURE_TEXT[profile.adventurousness]}.`);
  lines.push(`Price sensitivity: ${profile.priceSensitivity}.`);

  const feedback = Object.entries(profile.styleFeedback);
  const liked = feedback.filter(([, n]) => n > 0);
  const disliked = feedback.filter(([, n]) => n < 0);
  if (liked.length > 0) {
    lines.push(
      `Thumbs-up history: ${liked.map(([s, n]) => `${s} (+${n})`).join(", ")}.`
    );
  }
  if (disliked.length > 0) {
    lines.push(
      `Thumbs-down history: ${disliked.map(([s, n]) => `${s} (${n})`).join(", ")}.`
    );
  }
  return lines.join("\n");
}

export type FlavorProfile = { hoppy: number; malty: number; bitter: number; body: number };

// Typical flavor profile (each 0-5) for each style, used to derive what the
// drinker tends to like from their favorite styles + thumbs history.
const STYLE_FLAVOR: Record<string, FlavorProfile> = {
  IPA: { hoppy: 4.5, malty: 2, bitter: 4, body: 2.5 },
  "Hazy IPA": { hoppy: 4, malty: 2.5, bitter: 2.5, body: 3 },
  "Pale Ale": { hoppy: 3.5, malty: 2.5, bitter: 3, body: 2.5 },
  "Lager / Pilsner": { hoppy: 2, malty: 2.5, bitter: 2, body: 2 },
  "Stout / Porter": { hoppy: 1.5, malty: 4, bitter: 3, body: 4.5 },
  "Sour / Gose": { hoppy: 1, malty: 1.5, bitter: 1, body: 2 },
  "Wheat / Hefeweizen": { hoppy: 1.5, malty: 3, bitter: 1.5, body: 3 },
  Belgian: { hoppy: 2, malty: 3.5, bitter: 2.5, body: 3.5 },
  "Amber / Red Ale": { hoppy: 2.5, malty: 4, bitter: 2.5, body: 3 },
  "Cider / Seltzer": { hoppy: 0.5, malty: 0.5, bitter: 0.5, body: 1.5 },
};

// A weighted blend of the styles the drinker likes — favorites count strongly,
// thumbs feedback nudges it over time. Returns null when there's nothing to go on.
export function preferredFlavor(profile: TasteProfile | null): FlavorProfile | null {
  if (!profile) return null;
  const weights = new Map<string, number>();
  for (const s of profile.favoriteStyles) weights.set(s, (weights.get(s) ?? 0) + 2);
  for (const [s, n] of Object.entries(profile.styleFeedback)) {
    weights.set(s, (weights.get(s) ?? 0) + n);
  }
  const acc: FlavorProfile = { hoppy: 0, malty: 0, bitter: 0, body: 0 };
  let total = 0;
  for (const [style, w] of weights) {
    const f = STYLE_FLAVOR[style];
    if (!f || w <= 0) continue;
    total += w;
    acc.hoppy += f.hoppy * w;
    acc.malty += f.malty * w;
    acc.bitter += f.bitter * w;
    acc.body += f.body * w;
  }
  if (total <= 0) return null;
  return {
    hoppy: acc.hoppy / total,
    malty: acc.malty / total,
    bitter: acc.bitter / total,
    body: acc.body / total,
  };
}
