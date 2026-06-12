// Client-side scan history stored in localStorage.

export type HistoryBeer = {
  name: string;
  brewery: string;
  style: string;
  rating: number | null;
  ratingSource: "live" | "estimate";
  price: number | null;
};

export type HistoryEntry = {
  ts: number;
  thumb: string; // small JPEG data URL
  beers: HistoryBeer[];
};

const KEY = "findmybeer-history";
const MAX_ENTRIES = 30;

export function loadHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry: HistoryEntry): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify([entry, ...loadHistory()].slice(0, MAX_ENTRIES))
    );
  } catch {
    // Quota exceeded — drop oldest entries and retry once, then give up.
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify([entry, ...loadHistory()].slice(0, 5))
      );
    } catch {
      /* history is a nice-to-have; never break the scan over it */
    }
  }
}

export function clearHistory(): void {
  localStorage.removeItem(KEY);
}
