"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanResult } from "../api/scan/route";

type Beer = ScanResult["beers"][number];

const MAX_EDGE = 2000; // px — keeps image tokens reasonable while labels stay legible

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [beers, setBeers] = useState<Beer[] | null>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- false positive: startCamera only sets state after awaiting getUserMedia
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  async function scan(dataUrl: string) {
    stopCamera();
    setFrame(dataUrl);
    setScanning(true);
    setBeers(null);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
        signal: AbortSignal.timeout(180_000),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Scan failed. Try again.");
      } else {
        setBeers((json as ScanResult).beers);
      }
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "TimeoutError"
          ? "Scan timed out after 3 minutes. Try again."
          : `Couldn't reach the scan server (${err instanceof Error ? err.message : "network error"}).`
      );
    } finally {
      setScanning(false);
    }
  }

  function reset() {
    setFrame(null);
    setBeers(null);
    setError(null);
    startCamera();
  }

  const topRating =
    beers?.reduce<number | null>(
      (best, b) => (b.rating !== null && (best === null || b.rating > best) ? b.rating : best),
      null
    ) ?? null;
  const sortedBeers = beers
    ? [...beers].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    : null;

  return (
    <div className="flex flex-col flex-1 items-center bg-amber-50 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight text-amber-900 dark:text-amber-100">
          🍺 Scan the shelf
        </h1>
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          Point your camera at a beer shelf and scan. Each beer gets an
          approximate community rating out of 5 — the best picks are
          highlighted.
        </p>

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
                Upload a photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
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
                    } finally {
                      e.target.value = "";
                    }
                  }}
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
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <span className="animate-pulse rounded-full bg-white/90 px-5 py-2 text-sm font-medium text-zinc-900">
                    Reading labels…
                  </span>
                </div>
              )}
              {beers?.map(
                (beer, i) =>
                  beer.box && (
                    <div
                      key={i}
                      className={`absolute rounded-md border-2 ${
                        beer.rating !== null && beer.rating === topRating
                          ? "border-amber-400"
                          : "border-white/70"
                      }`}
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
                        {beer.rating !== null ? `★ ${beer.rating.toFixed(1)}` : "?"}
                      </span>
                    </div>
                  )
              )}
            </div>

            {sortedBeers && sortedBeers.length === 0 && (
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                No beers spotted in that photo — try getting closer to the shelf.
              </p>
            )}

            {sortedBeers && sortedBeers.length > 0 && (
              <ul className="w-full divide-y divide-amber-900/10 rounded-2xl bg-white shadow-sm dark:divide-amber-100/10 dark:bg-zinc-900">
                {sortedBeers.map((beer, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={`mt-0.5 min-w-14 rounded-full px-2 py-0.5 text-center text-sm font-bold ${
                        beer.rating !== null && beer.rating === topRating
                          ? "bg-amber-400 text-zinc-900"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {beer.rating !== null ? `★ ${beer.rating.toFixed(1)}` : "—"}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">
                        {beer.name}
                        <span className="font-normal text-zinc-500 dark:text-zinc-400">
                          {" "}
                          · {beer.brewery}
                        </span>
                      </p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {beer.style} · {beer.ratingBasis}
                        {beer.confidence !== "high" && ` (${beer.confidence} confidence)`}
                      </p>
                    </div>
                  </li>
                ))}
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
                Ratings are AI estimates of community scores (BeerAdvocate/Untappd
                style), not live data — treat them as a guide, not gospel.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
