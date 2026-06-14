"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { clearHistory, loadHistory, type HistoryEntry } from "@/lib/history";

export default function HistoryPage() {
  const { data: session, status: sessionStatus } = useSession();
  const authed = Boolean(session?.user);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    (async () => {
      const loaded = authed
        ? await fetch("/api/history")
            .then((r) => r.json())
            .then((j) => (j.entries as HistoryEntry[] | null) ?? [])
            .catch(() => [])
        : loadHistory();
      if (!cancelled) setEntries(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, authed]);

  async function clearAll() {
    if (authed) {
      await fetch("/api/history", { method: "DELETE" }).catch(() => {});
    } else {
      clearHistory();
    }
    setEntries([]);
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-amber-50 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-10">
        <div className="flex w-full items-baseline justify-center gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-amber-900 dark:text-amber-100">
            🍺 Scan history
          </h1>
          <Link
            href="/scan"
            className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
          >
            Scan
          </Link>
        </div>

        {entries && entries.length === 0 && (
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            No scans yet — scan a shelf and it&apos;ll show up here.{" "}
            {authed ? "History is saved to your account." : "History is stored only on this device."}
          </p>
        )}

        {entries && entries.length > 0 && (
          <>
            <ul className="flex w-full flex-col gap-4">
              {entries.map((entry) => {
                const sorted = [...entry.beers].sort(
                  (a, b) => (b.rating ?? -1) - (a.rating ?? -1)
                );
                return (
                  <li
                    key={entry.ts}
                    className="flex gap-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={entry.thumb}
                      alt="Scanned shelf"
                      className="h-24 w-24 shrink-0 rounded-xl object-cover"
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        {new Date(entry.ts).toLocaleString()} ·{" "}
                        {entry.beers.length} beer{entry.beers.length === 1 ? "" : "s"}
                      </p>
                      {sorted.slice(0, 3).map((beer, i) => (
                        <p
                          key={i}
                          className="truncate text-sm text-zinc-700 dark:text-zinc-300"
                        >
                          <span className="font-semibold">
                            {beer.ratingSource === "live" &&
                            (beer.untappd !== null || beer.beerAdvocate !== null)
                              ? [
                                  beer.untappd !== null && `UT ${beer.untappd.toFixed(1)}`,
                                  beer.beerAdvocate !== null &&
                                    `BA ${beer.beerAdvocate.toFixed(1)}`,
                                ]
                                  .filter(Boolean)
                                  .join(" ")
                              : beer.rating !== null
                                ? `~${beer.rating.toFixed(1)}`
                                : "—"}
                          </span>{" "}
                          {beer.name}
                          <span className="text-zinc-400 dark:text-zinc-500">
                            {" "}
                            · {beer.brewery}
                            {beer.price !== null && ` · $${beer.price.toFixed(2)}`}
                          </span>
                        </p>
                      ))}
                      {sorted.length > 3 && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          +{sorted.length - 3} more
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              onClick={clearAll}
              className="text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              Clear history
            </button>
          </>
        )}
      </main>
    </div>
  );
}
