import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-amber-50 font-sans dark:bg-zinc-950">
      <main className="flex w-full max-w-2xl flex-col items-center gap-8 px-8 py-24 text-center">
        <span className="text-6xl" role="img" aria-label="Beer">
          🍺
        </span>
        <h1 className="text-5xl font-bold tracking-tight text-amber-900 dark:text-amber-100">
          FindMyBeer
        </h1>
        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Standing in front of a wall of beer? Point your camera at the shelf
          and see which ones are actually worth drinking — each beer gets a
          rating overlay so the best picks jump out.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/scan"
            className="flex h-14 items-center rounded-full bg-amber-600 px-10 text-lg font-medium text-white transition-colors hover:bg-amber-700"
          >
            📷 Scan a shelf
          </Link>
          <Link
            href="/signup"
            className="flex h-14 items-center rounded-full border border-amber-900/20 bg-white px-10 text-lg font-medium text-zinc-700 hover:border-amber-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-300"
          >
            Sign up
          </Link>
        </div>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Works with your phone camera or an uploaded photo. An account keeps
          your taste and history everywhere and sharpens your picks over time.
        </p>
      </main>
    </div>
  );
}
