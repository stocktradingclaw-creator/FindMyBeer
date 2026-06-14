"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { saveHistoryEntry, type HistoryBeer } from "@/lib/history";
import {
  loadTaste,
  preferredFlavor,
  recordStyleFeedback,
  tasteSummary,
  type FlavorProfile,
  type TasteProfile,
} from "@/lib/taste";
import {
  blankDetails,
  type IdentifiedBeer,
  type Recommendation,
  type ScanBeer,
} from "@/lib/types";

type Beer = ScanBeer;

const MAX_EDGE = 2000; // px — keeps image tokens reasonable while labels stay legible

// Set when a photo picker opens; if it's still set on the next page load, the
// browser reloaded the tab mid-pick (Android low-memory discard) and we can
// tell the user instead of failing silently.
const PICK_FLAG = "findmybeer-picking";

// Origin tiers nest: local ⊂ regional ⊂ domestic. International stands alone.
const ORIGIN_RANK = { local: 0, regional: 1, domestic: 2, international: 3 } as const;
type OriginFilter = "all" | keyof typeof ORIGIN_RANK;
const ORIGIN_LABELS: Record<Exclude<OriginFilter, "all">, string> = {
  local: "Local",
  regional: "Regional",
  domestic: "Domestic",
  international: "International",
};

function matchesOrigin(beer: { origin: keyof typeof ORIGIN_RANK | null }, filter: OriginFilter) {
  if (filter === "all") return true;
  if (!beer.origin) return false;
  if (filter === "international") return beer.origin === "international";
  return ORIGIN_RANK[beer.origin] <= ORIGIN_RANK[filter];
}

// Compact score string for the photo overlay badge (space is tight there).
// Live beers always show both sites as UT/BA with a dash for a missing one.
function overlayScore(beer: Beer): string {
  if (beer.ratingSource === "live") {
    const ut = beer.untappd !== null ? beer.untappd.toFixed(1) : "–";
    const ba = beer.beerAdvocate !== null ? beer.beerAdvocate.toFixed(1) : "–";
    return `${ut}/${ba}`;
  }
  return beer.rating !== null ? `~${beer.rating.toFixed(1)}` : "?";
}

function chipClass(highlight: boolean): string {
  return `rounded-full px-2 py-0.5 text-center text-xs font-semibold ${
    highlight
      ? "bg-amber-400 text-zinc-900"
      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
  }`;
}

// Only trust a model-supplied color if it's a plain hex value.
function safeColor(hex: string | null): string | null {
  return hex && /^#[0-9a-fA-F]{3,8}$/.test(hex) ? hex : null;
}

type CommentaryData = { overview: string; notes: string[]; found: boolean };
type CommentaryState = { loading: boolean; data?: CommentaryData; error?: string };

const SEASON_META: Record<string, { label: string; emoji: string; cls: string }> = {
  winter: { label: "Winter", emoji: "❄️", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  spring: { label: "Spring", emoji: "🌱", cls: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" },
  summer: { label: "Summer", emoji: "☀️", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200" },
  fall: { label: "Fall", emoji: "🍂", cls: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200" },
  any: { label: "Year-round", emoji: "🗓️", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

// Only flag the hard-to-find ones; common beers get no badge.
const AVAILABILITY_META: Record<string, { label: string; emoji: string; cls: string }> = {
  limited: { label: "Limited", emoji: "🔭", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
  rare: { label: "Rare find", emoji: "🦄", cls: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200" },
};

function FlavorBars({
  flavor,
  pref,
}: {
  flavor: FlavorProfile;
  pref: FlavorProfile | null;
}) {
  const rows: [string, keyof FlavorProfile][] = [
    ["Hoppy", "hoppy"],
    ["Malty", "malty"],
    ["Bitter", "bitter"],
    ["Body", "body"],
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([label, axisKey]) => {
        const v = flavor[axisKey];
        const p = pref?.[axisKey];
        return (
          <div key={label} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
              {label}
            </span>
            <div className="relative h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full rounded-full bg-amber-500"
                style={{ width: `${(Math.max(0, Math.min(5, v)) / 5) * 100}%` }}
              />
              {p != null && (
                <div
                  className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded bg-violet-600 dark:bg-violet-400"
                  style={{ left: `${(Math.max(0, Math.min(5, p)) / 5) * 100}%` }}
                  title="Your preference"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function captureFrame(video: HTMLVideoElement): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function fileToJpegDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable on this browser.");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Couldn't process that photo."));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          `Couldn't read that photo (${file.type || "unknown type"}, ${(file.size / 1e6).toFixed(1)}MB). Try retaking it.`
        )
      );
    };
    img.src = url;
  });
}

export default function ScanPage() {
  const { data: session, status: sessionStatus } = useSession();
  const authed = Boolean(session?.user);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [beers, setBeers] = useState<Beer[] | null>(null);
  const [rec, setRec] = useState<Recommendation>(null);
  const [enriching, setEnriching] = useState(false);
  const [hasTaste, setHasTaste] = useState(true);
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [votes, setVotes] = useState<Record<string, 1 | -1>>({});
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [commentary, setCommentary] = useState<Record<number, CommentaryState>>({});
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError(null);
      setCameraReady(true);
    } catch {
      setCameraError("Camera unavailable — upload a photo instead.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount beacon + reload detection must run synchronously on mount
    setMounted(true);
    const pickedAt = Number(sessionStorage.getItem(PICK_FLAG));
    sessionStorage.removeItem(PICK_FLAG);
    if (pickedAt && Date.now() - pickedAt < 5 * 60_000) {
      setError(
        "Your browser reloaded the page while the photo picker was open (an Android low-memory quirk). Close other apps/tabs and try again."
      );
    }
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  async function scan(dataUrl: string) {
    stopCamera();
    setFrame(dataUrl);
    setScanning(true);
    setBeers(null);
    setRec(null);
    setVotes({});
    setOriginFilter("all");
    setElapsedMs(0);
    setEnriching(false);
    setExpandedIdx(null);
    setCommentary({});
    setError(null);
    try {
      // Phase 1 — identify the beers from the photo (fast).
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Scan failed. Try again.");
        setScanning(false);
        return;
      }
      const identified = (json as { beers: IdentifiedBeer[] }).beers;
      const initial: Beer[] = identified.map((b) => ({
        ...b,
        ...blankDetails(),
        untappd: null,
        beerAdvocate: null,
        ratingSource: "estimate" as const,
        detailsLoaded: false,
      }));
      setBeers(initial);
      setScanning(false);
      if (initial.length > 0) enrich(dataUrl, initial);
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "Scan timed out. Try again."
          : `Couldn't reach the scan server (${err instanceof Error ? err.message : "network error"}).`
      );
      setScanning(false);
    }
  }

  // Phases 2 & 3 — knowledge attributes and live ratings, fetched in parallel
  // and merged into the already-visible beer list as each arrives.
  async function enrich(dataUrl: string, initial: Beer[]) {
    setEnriching(true);
    let latest = initial;
    const apply = (fn: (prev: Beer[]) => Beer[]) =>
      setBeers((prev) => {
        latest = fn(prev ?? []);
        return latest;
      });

    const tasteProfile = loadTaste();
    const detailsReq = fetch("/api/details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        beers: initial.map(({ name, brewery, style, price }) => ({ name, brewery, style, price })),
        taste: tasteProfile ? tasteSummary(tasteProfile) : null,
        location: tasteProfile?.location?.trim() || null,
      }),
      signal: AbortSignal.timeout(90_000),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && Array.isArray(j.details)) {
          apply((prev) =>
            prev.map((b, i) => {
              const d = j.details[i];
              if (!d) return { ...b, detailsLoaded: true };
              const keepLive = b.ratingSource === "live";
              return {
                ...b,
                ...d,
                rating: keepLive ? b.rating : d.rating,
                ratingBasis: keepLive ? b.ratingBasis : d.ratingBasis,
                detailsLoaded: true,
              };
            })
          );
          setRec(j.recommendation ?? null);
        } else {
          apply((prev) => prev.map((b) => ({ ...b, detailsLoaded: true })));
        }
      })
      .catch(() => apply((prev) => prev.map((b) => ({ ...b, detailsLoaded: true }))));

    const ratingsReq = fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beers: initial.map(({ name, brewery }) => ({ name, brewery })) }),
      signal: AbortSignal.timeout(150_000),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !Array.isArray(j.ratings)) return;
        apply((prev) =>
          prev.map((b, i) => {
            const r = j.ratings[i] as { untappd: number | null; beerAdvocate: number | null } | null;
            const scores = r
              ? [r.untappd, r.beerAdvocate].filter((n): n is number => typeof n === "number")
              : [];
            if (r && scores.length > 0) {
              const consolidated =
                Math.round((scores.reduce((a, c) => a + c, 0) / scores.length) * 10) / 10;
              return {
                ...b,
                untappd: r.untappd,
                beerAdvocate: r.beerAdvocate,
                rating: consolidated,
                ratingBasis: "Consolidated from live site scores",
                ratingSource: "live" as const,
              };
            }
            return b;
          })
        );
      })
      .catch(() => {});

    await Promise.allSettled([detailsReq, ratingsReq]);
    setEnriching(false);
    recordHistory(dataUrl, latest);
  }

  function reset() {
    setFrame(null);
    setBeers(null);
    setRec(null);
    setEnriching(false);
    setVotes({});
    setOriginFilter("all");
    setExpandedIdx(null);
    setCommentary({});
    setError(null);
    startCamera();
  }

  function vote(beer: Beer, value: 1 | -1) {
    const previous = votes[beer.name] ?? 0;
    if (previous === value) return;
    const delta = value - previous;
    if (authed) {
      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style: beer.style, delta }),
      }).catch(() => {});
    } else {
      recordStyleFeedback(beer.style, delta);
    }
    setVotes((v) => ({ ...v, [beer.name]: value }));
  }

  // Clicking a box on the photo scrolls to that beer's row and flashes it.
  function focusBeer(idx: number) {
    setFocusedIdx(idx);
    document
      .getElementById(`beer-${idx}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setFocusedIdx((cur) => (cur === idx ? null : cur)), 1600);
  }

  // Expand a row to show its review summary, fetching it once on first open.
  async function toggleCommentary(beer: Beer, idx: number) {
    if (expandedIdx === idx) {
      setExpandedIdx(null);
      return;
    }
    setExpandedIdx(idx);
    if (commentary[idx]) return; // already loading or loaded
    setCommentary((c) => ({ ...c, [idx]: { loading: true } }));
    try {
      const res = await fetch("/api/commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: beer.name, brewery: beer.brewery }),
        signal: AbortSignal.timeout(90_000),
      });
      const json = await res.json();
      setCommentary((c) => ({
        ...c,
        [idx]: res.ok
          ? { loading: false, data: json }
          : { loading: false, error: json.error ?? "Couldn't load reviews." },
      }));
    } catch {
      setCommentary((c) => ({
        ...c,
        [idx]: { loading: false, error: "Couldn't reach the server." },
      }));
    }
  }

  useEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    (async () => {
      const prof = authed
        ? await fetch("/api/taste")
            .then((r) => r.json())
            .then((j) => (j.profile as TasteProfile | null) ?? null)
            .catch(() => null)
        : loadTaste();
      if (!cancelled) {
        setProfile(prof);
        setHasTaste(prof !== null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, authed]);

  // Tick an elapsed-time counter while a scan is in flight, so the progress
  // UI keeps visibly moving (the request itself returns everything at once).
  useEffect(() => {
    if (!scanning) return;
    const start = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), 250);
    return () => window.clearInterval(id);
  }, [scanning]);

  function markPicking() {
    sessionStorage.setItem(PICK_FLAG, String(Date.now()));
  }

  function recordHistory(dataUrl: string, found: Beer[]) {
    // Fire-and-forget: shrink the frame to a thumbnail and store the scan —
    // in the account when signed in, otherwise on this device.
    const img = new Image();
    img.onload = () => {
      const scale = 240 / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const thumb = canvas.toDataURL("image/jpeg", 0.6);
      const beers: HistoryBeer[] = found.map(
        ({ name, brewery, style, rating, untappd, beerAdvocate, ratingSource, price }) => ({
          name,
          brewery,
          style,
          rating,
          untappd,
          beerAdvocate,
          ratingSource,
          price,
        })
      );
      if (authed) {
        fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thumb, beers }),
        }).catch(() => {});
      } else {
        saveHistoryEntry({ ts: Date.now(), thumb, beers });
      }
    };
    img.src = dataUrl;
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    sessionStorage.removeItem(PICK_FLAG);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setProcessing(true);
    try {
      const dataUrl = await fileToJpegDataUrl(file);
      setProcessing(false);
      await scan(dataUrl);
    } catch (err) {
      setProcessing(false);
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  const topRating =
    beers?.reduce<number | null>(
      (best, b) => (b.rating !== null && (best === null || b.rating > best) ? b.rating : best),
      null
    ) ?? null;
  const sortedBeers = beers
    ? [...beers].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    : null;
  const recBeer = rec && beers ? (beers[rec.index] ?? null) : null;
  const visibleBeers = sortedBeers?.filter((b) => matchesOrigin(b, originFilter)) ?? null;
  const originCount = (filter: OriginFilter) =>
    beers?.filter((b) => matchesOrigin(b, filter)).length ?? 0;
  const prefFlavor = preferredFlavor(profile);

  const elapsedSec = Math.floor(elapsedMs / 1000);
  // Eases toward (not to) 100% so the bar always advances but never claims done.
  const scanProgress = Math.min(96, Math.round(100 * (1 - Math.exp(-elapsedMs / 32000))));
  const scanStage =
    elapsedSec < 5
      ? "Looking at the shelf…"
      : elapsedSec < 15
        ? "Reading the labels…"
        : "Identifying the beers…";
  const pricedBeers =
    beers?.filter((b) => b.price !== null && b.price > 0 && b.rating !== null) ?? [];
  const bestValue =
    pricedBeers.length >= 2
      ? pricedBeers.reduce((best, b) =>
          b.rating! / b.price! > best.rating! / best.price! ? b : best
        )
      : null;

  return (
    <div className="flex flex-col flex-1 items-center bg-amber-50 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-10">
        <div className="flex w-full items-baseline justify-center gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-amber-900 dark:text-amber-100">
            🍺 Scan the shelf
          </h1>
          <Link
            href="/history"
            className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
          >
            History
          </Link>
          <Link
            href="/taste"
            className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
          >
            Taste
          </Link>
          {sessionStatus !== "loading" &&
            (authed ? (
              <button
                onClick={() => signOut({ redirectTo: "/scan" })}
                className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
              >
                Sign out{session?.user?.name ? ` (${session.user.name.split(" ")[0]})` : ""}
              </button>
            ) : (
              <Link
                href="/login"
                className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
              >
                Sign in
              </Link>
            ))}
        </div>

        {mounted && !hasTaste && (
          <Link
            href="/taste"
            className="w-full rounded-xl bg-violet-100 px-4 py-3 text-center text-sm font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200"
          >
            🎯 Tell us what you like to drink and every scan gets a personal pick →
          </Link>
        )}
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          Point your camera at a beer shelf and scan. Each beer gets an
          approximate community rating out of 5 — the best picks are
          highlighted.
        </p>

        {!mounted && (
          <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
            Starting the scanner… if this message never goes away, JavaScript
            failed to load on this browser.
          </p>
        )}

        {error && (
          <p className="w-full rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {processing && (
          <p className="animate-pulse text-center text-sm font-medium text-amber-700 dark:text-amber-300">
            Processing photo…
          </p>
        )}

        {!frame && (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="relative w-full overflow-hidden rounded-2xl bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full"
                aria-label="Camera viewfinder"
              />
              {cameraError && (
                <div className="flex h-48 items-center justify-center px-6 text-center text-sm text-zinc-300">
                  {cameraError}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {cameraReady && (
                <button
                  onClick={() => videoRef.current && scan(captureFrame(videoRef.current))}
                  className="h-12 rounded-full bg-amber-600 px-8 text-base font-medium text-white transition-colors hover:bg-amber-700"
                >
                  Scan
                </button>
              )}
              <label className="flex h-12 cursor-pointer items-center rounded-full border border-amber-900/20 bg-white px-6 text-base text-zinc-700 hover:border-amber-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-300">
                📷 Take photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onClick={markPicking}
                  onChange={onPickFile}
                />
              </label>
              <label className="flex h-12 cursor-pointer items-center rounded-full border border-amber-900/20 bg-white px-6 text-base text-zinc-700 hover:border-amber-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-300">
                🖼️ From gallery
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onClick={markPicking}
                  onChange={onPickFile}
                />
              </label>
            </div>
          </div>
        )}

        {frame && (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="relative w-full overflow-hidden rounded-2xl">
              {/* Captured frame with positioned rating badges */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={frame} alt="Captured shelf" className="w-full" />
              {scanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-6">
                  <span className="text-center text-sm font-medium text-white">
                    {scanStage}
                  </span>
                  <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-[width] duration-300 ease-out"
                      style={{ width: `${scanProgress}%` }}
                    />
                  </div>
                  <span className="text-xs text-white/70">
                    {elapsedSec}s · new beers take a little longer to look up
                  </span>
                </div>
              )}
              {beers?.map(
                (beer, i) =>
                  beer.box &&
                  matchesOrigin(beer, originFilter) && (
                    <button
                      key={i}
                      type="button"
                      onClick={() => focusBeer(i)}
                      aria-label={`Jump to ${beer.name} in the list below`}
                      className={`absolute cursor-pointer rounded-md border-2 transition-shadow ${
                        beer === recBeer
                          ? "border-violet-400"
                          : beer.rating !== null && beer.rating === topRating
                            ? "border-amber-400"
                            : "border-white/70"
                      } ${focusedIdx === i ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
                      style={{
                        left: `${beer.box.x * 100}%`,
                        top: `${beer.box.y * 100}%`,
                        width: `${beer.box.w * 100}%`,
                        height: `${beer.box.h * 100}%`,
                      }}
                    >
                      <span
                        className={`absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold shadow ${
                          beer.rating !== null && beer.rating === topRating
                            ? "bg-amber-400 text-zinc-900"
                            : "bg-white/90 text-zinc-800"
                        }`}
                      >
                        {overlayScore(beer)}
                      </span>
                    </button>
                  )
              )}
            </div>

            {sortedBeers && sortedBeers.length === 0 && (
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                No beers spotted in that photo — try getting closer to the shelf.
              </p>
            )}

            {beers && beers.length > 0 && (
              <div className="flex w-full flex-wrap justify-center gap-2">
                {(["all", "local", "regional", "domestic", "international"] as const).map(
                  (filter) =>
                    (filter === "all" || originCount(filter) > 0) && (
                      <button
                        key={filter}
                        onClick={() => setOriginFilter(filter)}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                          originFilter === filter
                            ? "bg-amber-600 text-white"
                            : "border border-amber-900/20 bg-white text-zinc-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-400"
                        }`}
                      >
                        {filter === "all"
                          ? `All (${beers.length})`
                          : `${ORIGIN_LABELS[filter]} (${originCount(filter)})`}
                      </button>
                    )
                )}
              </div>
            )}

            {recBeer && rec && (
              <div className="w-full rounded-2xl border-2 border-violet-400 bg-white p-4 dark:bg-zinc-900">
                <p className="font-semibold text-violet-700 dark:text-violet-300">
                  🎯 Your pick: {recBeer.name}
                  <span className="font-normal text-zinc-500 dark:text-zinc-400">
                    {" "}
                    · {recBeer.brewery}
                  </span>
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{rec.reason}</p>
              </div>
            )}

            {enriching && (
              <p className="animate-pulse text-center text-xs text-amber-700 dark:text-amber-300">
                Adding details & live ratings…
              </p>
            )}

            {sortedBeers && sortedBeers.length > 0 && visibleBeers?.length === 0 && (
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                No {originFilter} beers in this scan — tap All to see everything.
              </p>
            )}

            {visibleBeers && visibleBeers.length > 0 && (
              <ul className="w-full divide-y divide-amber-900/10 rounded-2xl bg-white shadow-sm dark:divide-amber-100/10 dark:bg-zinc-900">
                {visibleBeers.map((beer) => {
                  const origIdx = (beers ?? []).indexOf(beer);
                  const isTop = beer.rating !== null && beer.rating === topRating;
                  return (
                  <li
                    key={origIdx}
                    id={`beer-${origIdx}`}
                    className={`px-4 py-3 transition-colors ${
                      focusedIdx === origIdx ? "bg-amber-100 dark:bg-amber-950" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex min-w-16 flex-col gap-1">
                      {beer.ratingSource === "live" ? (
                        <>
                          <span className={chipClass(isTop)}>
                            UT {beer.untappd !== null ? beer.untappd.toFixed(1) : "—"}
                          </span>
                          <span className={chipClass(isTop)}>
                            BA {beer.beerAdvocate !== null ? beer.beerAdvocate.toFixed(1) : "—"}
                          </span>
                        </>
                      ) : beer.rating !== null ? (
                        <span className={chipClass(isTop)}>~{beer.rating.toFixed(1)}</span>
                      ) : (
                        <span className="animate-pulse rounded-full bg-zinc-100 px-2 py-0.5 text-center text-xs text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                          ···
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleCommentary(beer, origIdx)}
                      aria-expanded={expandedIdx === origIdx}
                      className="min-w-0 flex-1 cursor-pointer text-left"
                    >
                      <span className="block font-medium text-zinc-900 dark:text-zinc-50">
                        {beer.name}
                        <span className="font-normal text-zinc-500 dark:text-zinc-400">
                          {" "}
                          · {beer.brewery}
                        </span>
                        {beer === recBeer && (
                          <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                            🎯 Your pick
                          </span>
                        )}
                        {beer === bestValue && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                            💰 Best value
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                        {beer.rating !== null && (
                          <span
                            className={
                              beer.ratingSource === "live"
                                ? "font-medium text-emerald-600 dark:text-emerald-400"
                                : "text-zinc-400 dark:text-zinc-500"
                            }
                          >
                            {beer.ratingSource === "live" ? "live · " : "est. · "}
                          </span>
                        )}
                        {beer.price !== null && `$${beer.price.toFixed(2)} · `}
                        {beer.style}
                        {beer.breweryLocation !== null && ` · ${beer.breweryLocation}`}
                        {beer.ratingSource === "estimate" && ` · ${beer.ratingBasis}`}
                        {beer.confidence !== "high" && ` (${beer.confidence} confidence)`}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {!beer.detailsLoaded && (
                          <span className="animate-pulse">adding details…</span>
                        )}
                        {safeColor(beer.colorHex) && (
                          <span
                            className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 dark:border-white/20"
                            style={{ backgroundColor: safeColor(beer.colorHex)! }}
                          />
                        )}
                        {beer.abv !== null && (
                          <span className="font-medium">{beer.abv.toFixed(1)}% ABV</span>
                        )}
                        {beer.season && SEASON_META[beer.season] && (
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${SEASON_META[beer.season].cls}`}
                          >
                            {SEASON_META[beer.season].emoji} {SEASON_META[beer.season].label}
                          </span>
                        )}
                        {beer.availability && AVAILABILITY_META[beer.availability] && (
                          <span
                            className={`rounded-full px-2 py-0.5 font-medium ${AVAILABILITY_META[beer.availability].cls}`}
                          >
                            {AVAILABILITY_META[beer.availability].emoji}{" "}
                            {AVAILABILITY_META[beer.availability].label}
                          </span>
                        )}
                        <span className="text-amber-700 dark:text-amber-300">
                          {expandedIdx === origIdx ? "Hide details ▴" : "Details & reviews ▾"}
                        </span>
                      </span>
                    </button>
                    <div className="ml-auto flex shrink-0 gap-1">
                      <button
                        onClick={() => vote(beer, 1)}
                        aria-label={`Like ${beer.name}`}
                        className={`rounded-full px-2 py-1 text-sm transition-colors ${
                          votes[beer.name] === 1
                            ? "bg-emerald-100 dark:bg-emerald-900"
                            : "opacity-40 hover:opacity-100"
                        }`}
                      >
                        👍
                      </button>
                      <button
                        onClick={() => vote(beer, -1)}
                        aria-label={`Dislike ${beer.name}`}
                        className={`rounded-full px-2 py-1 text-sm transition-colors ${
                          votes[beer.name] === -1
                            ? "bg-red-100 dark:bg-red-900"
                            : "opacity-40 hover:opacity-100"
                        }`}
                      >
                        👎
                      </button>
                    </div>
                    </div>
                    {expandedIdx === origIdx && (
                      <div className="mt-3 rounded-xl bg-amber-50/80 p-3 dark:bg-zinc-800/50">
                        {beer.flavor && (
                          <div className="mb-3">
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                              Flavor
                            </p>
                            <FlavorBars flavor={beer.flavor} pref={prefFlavor} />
                            {prefFlavor && (
                              <p className="mt-1.5 text-[11px] text-violet-600 dark:text-violet-400">
                                The violet marker is your usual taste — closer bars mean a better
                                match.
                              </p>
                            )}
                          </div>
                        )}
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                          What people say
                        </p>
                        {commentary[origIdx]?.loading && (
                          <p className="animate-pulse text-sm text-zinc-500 dark:text-zinc-400">
                            Reading Untappd &amp; BeerAdvocate reviews…
                          </p>
                        )}
                        {commentary[origIdx]?.error && (
                          <p className="text-sm text-red-600 dark:text-red-400">
                            {commentary[origIdx]?.error}
                          </p>
                        )}
                        {commentary[origIdx]?.data && (
                          <>
                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                              {commentary[origIdx]?.data?.overview}
                            </p>
                            {(commentary[origIdx]?.data?.notes.length ?? 0) > 0 && (
                              <ul className="mt-2 flex flex-wrap gap-1.5">
                                {commentary[origIdx]?.data?.notes.map((n, k) => (
                                  <li
                                    key={k}
                                    className="rounded-full bg-white px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                                  >
                                    {n}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}

            {!scanning && (
              <button
                onClick={reset}
                className="h-12 rounded-full bg-amber-600 px-8 text-base font-medium text-white transition-colors hover:bg-amber-700"
              >
                Scan again
              </button>
            )}

            {sortedBeers && sortedBeers.length > 0 && (
              <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
                On <span className="text-emerald-600 dark:text-emerald-400">live</span> beers the
                badges show the Untappd (UT) and BeerAdvocate (BA) community scores out of 5;{" "}
                <em>est.</em> means an AI estimate. Tap a box on the photo to jump to that beer, or
                tap a beer in the list for its flavor profile and a review summary.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
