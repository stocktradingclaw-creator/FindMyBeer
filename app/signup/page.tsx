import AuthForm from "@/components/auth-form";
import { googleEnabled } from "@/auth";

export default function SignupPage() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-amber-50 px-6 font-sans dark:bg-zinc-950">
      <main className="flex w-full flex-col items-center gap-6 py-16">
        <span className="text-5xl" role="img" aria-label="Beer">
          🍺
        </span>
        <h1 className="text-3xl font-bold tracking-tight text-amber-900 dark:text-amber-100">
          Join FindMyBeer
        </h1>
        <p className="max-w-sm text-center text-sm text-zinc-600 dark:text-zinc-400">
          Your taste profile and 👍/👎 history follow you across devices, and
          recommendations get smarter the more you use it.
        </p>
        <AuthForm mode="signup" googleEnabled={googleEnabled()} />
      </main>
    </div>
  );
}
