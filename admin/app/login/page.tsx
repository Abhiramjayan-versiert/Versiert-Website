import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  config: "GitHub sign-in isn't configured yet (GITHUB_CLIENT_ID is missing on the server).",
  state: "The sign-in link expired. Please try again.",
  token: "GitHub didn't accept the sign-in. Please try again.",
  user: "Couldn't read your GitHub profile. Please try again.",
  not_allowed: "This GitHub account isn't allowed to use the admin.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="flex min-h-svh items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <p className="text-2xl font-semibold tracking-[-0.04em]">
          VERSIERT <span className="font-mono text-xs font-normal tracking-[0.5em] text-white/60">ADMIN</span>
        </p>
        <h1 className="mt-10 text-3xl font-medium tracking-[-0.03em]">Sign in</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          Private workspace for the versiert.in website and your SaaS apps directory.
        </p>
        {error && (
          <p role="alert" className="mt-6 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {ERRORS[error] || "Sign-in failed."}
          </p>
        )}
        <a href="/api/auth/github" className="btn btn-primary mt-8 h-12 w-full">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Continue with GitHub
        </a>
        {env.devLogin && (
          <form action="/api/auth/dev" method="post" className="mt-3">
            <button className="btn btn-ghost h-12 w-full" type="submit">
              Dev sign-in (local only)
            </button>
          </form>
        )}
        <p className="mt-8 text-xs leading-relaxed text-white/35">
          Only approved GitHub accounts can sign in. Changes you save are committed to GitHub and published to versiert.in
          automatically.
        </p>
      </div>
    </main>
  );
}
