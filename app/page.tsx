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
          Find the right beer, wherever you are. Search by style, brewery, or
          what&apos;s on tap near you.
        </p>
        <form className="flex w-full max-w-md gap-2">
          <input
            type="search"
            name="q"
            placeholder="Try “hazy IPA” or “stout”…"
            className="h-12 flex-1 rounded-full border border-amber-900/20 bg-white px-5 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-amber-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            className="h-12 rounded-full bg-amber-600 px-6 text-base font-medium text-white transition-colors hover:bg-amber-700"
          >
            Search
          </button>
        </form>
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Search is a placeholder — the beer data is coming soon.
        </p>
      </main>
    </div>
  );
}
