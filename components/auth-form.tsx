"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "next-auth/react";

export default function AuthForm({
  mode,
  googleEnabled,
}: {
  mode: "login" | "signup";
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? "Sign-up failed. Try again.");
          return;
        }
      }
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(
          mode === "login"
            ? "Wrong email or password."
            : "Account created but sign-in failed — try the sign-in page."
        );
        return;
      }
      router.push(mode === "signup" ? "/taste" : "/scan");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "h-12 rounded-full border border-amber-900/20 bg-white px-5 text-base text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-amber-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            autoComplete="name"
            className={inputClass}
          />
        )}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          className={inputClass}
        />
        <input
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={busy}
          className="h-12 rounded-full bg-amber-600 text-base font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? "One sec…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      {googleEnabled && (
        <button
          onClick={() => signIn("google", { redirectTo: "/scan" })}
          className="h-12 rounded-full border border-amber-900/20 bg-white text-base font-medium text-zinc-700 hover:border-amber-600 dark:border-amber-100/20 dark:bg-zinc-900 dark:text-zinc-300"
        >
          Continue with Google
        </button>
      )}

      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-amber-700 dark:text-amber-300">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-medium text-amber-700 dark:text-amber-300">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
