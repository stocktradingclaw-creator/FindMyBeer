"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  BEER_STYLES,
  loadTaste,
  saveTaste,
  type TasteProfile,
} from "@/lib/taste";

const ADVENTURE_OPTIONS: { value: TasteProfile["adventurousness"]; label: string }[] = [
  { value: "stick", label: "Stick to what I like" },
  { value: "balanced", label: "Mostly favorites, occasional surprise" },
  { value: "explore", label: "Surprise me with something interesting" },
];

const PRICE_OPTIONS: { value: TasteProfile["priceSensitivity"]; label: string }[] = [
  { value: "low", label: "Price barely matters" },
  { value: "medium", label: "Price matters some" },
  { value: "high", label: "I watch the price" },
];

export default function TastePage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const authed = Boolean(session?.user);
  const [styles, setStyles] = useState<string[]>([]);
  const [adventurousness, setAdventurousness] =
    useState<TasteProfile["adventurousness"]>("balanced");
  const [priceSensitivity, setPriceSensitivity] =
    useState<TasteProfile["priceSensitivity"]>("medium");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    (async () => {
      const existing = authed
        ? await fetch("/api/taste")
            .then((r) => r.json())
            .then((j) => (j.profile as TasteProfile | null) ?? null)
            .catch(() => null)
        : loadTaste();
      if (cancelled || !existing) return;
      setStyles(existing.favoriteStyles);
      setAdventurousness(existing.adventurousness);
      setPriceSensitivity(existing.priceSensitivity);
      setLocation(existing.location ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, authed]);

  function toggleStyle(style: string) {
    setStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  }

  async function save() {
    const profile: TasteProfile = {
      favoriteStyles: styles,
      adventurousness,
      priceSensitivity,
      location: location.trim(),
      styleFeedback: loadTaste()?.styleFeedback ?? {},
    };
    if (authed) {
      setBusy(true);
      try {
        await fetch("/api/taste", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profile),
        });
      } finally {
        setBusy(false);
      }
    } else {
      saveTaste(profile);
    }
    router.push("/scan");
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-amber-50 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-amber-900 dark:text-amber-100">
            🎯 Your taste
          </h1>
          <Link
            href="/scan"
            className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
          >
            Scan
          </Link>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This shapes the &ldquo;your pick&rdquo; recommendation on every scan. It also
          learns from your 👍/👎 on scanned beers — all stored only on this device.
        </p>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
            What do you like to drink?
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {BEER_STYLES.map((style) => (
              <label
                key={style}
                className={`flex h-11 cursor-pointer items-center justify-center rounded-full border px-3 text-sm transition-colors ${
                  styles.includes(style)
                    ? "border-amber-600 bg-amber-600 text-white"
                    : "border-amber-900/20 bg-white text-zinc-700 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={styles.includes(style)}
                  onChange={() => toggleStyle(style)}
                />
                {style}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
            How adventurous are you?
          </legend>
          {ADVENTURE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <input
                type="radio"
                name="adventurousness"
                checked={adventurousness === opt.value}
                onChange={() => setAdventurousness(opt.value)}
                className="accent-amber-600"
              />
              {opt.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
            How much does price matter?
          </legend>
          {PRICE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <input
                type="radio"
                name="price"
                checked={priceSensitivity === opt.value}
                onChange={() => setPriceSensitivity(opt.value)}
                className="accent-amber-600"
              />
              {opt.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold text-zinc-900 dark:text-zinc-50">
            Where are you? <span className="font-normal text-zinc-400">(optional)</span>
          </legend>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Denver, CO"
            className="h-11 rounded-full border border-amber-900/20 bg-white px-5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-amber-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Lets scans tag each beer as local, regional, domestic, or international.
          </p>
        </fieldset>

        <button
          onClick={save}
          disabled={busy}
          className="h-12 rounded-full bg-amber-600 px-8 text-base font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save & scan"}
        </button>

        {sessionStatus !== "loading" && !authed && (
          <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
            Saved on this device only.{" "}
            <Link href="/signup" className="font-medium text-amber-700 dark:text-amber-300">
              Create an account
            </Link>{" "}
            to keep your taste everywhere and improve picks over time.
          </p>
        )}
      </main>
    </div>
  );
}
