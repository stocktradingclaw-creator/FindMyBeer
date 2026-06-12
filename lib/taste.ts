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
