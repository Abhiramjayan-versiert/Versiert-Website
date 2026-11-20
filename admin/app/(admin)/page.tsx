import Link from "next/link";
import { ArrowUpRight, Boxes, CircleDashed, ImageOff, Sparkles } from "lucide-react";
import { env } from "@/lib/env";
import { findTodos } from "@/lib/placeholders";
import { sections } from "@/lib/schema";
import { requireSession } from "@/lib/session";
import { loadContent, loadSaas } from "@/lib/store";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const s = await requireSession();
  const [site, home, services, projects, testimonials, saas] = await Promise.all([
    loadContent("site", s),
    loadContent("home", s),
    loadContent("services", s),
    loadContent("projects", s),
    loadContent("testimonials", s),
    loadSaas(s).catch(() => null),
  ]);
  const todos = findTodos({ site: site.data, home: home.data, services: services.data, projects: projects.data, testimonials: testimonials.data });
  const required = todos.filter((t) => t.kind !== "optional");
  const optional = todos.filter((t) => t.kind === "optional");
  const apps = ((saas?.data as { apps?: { status?: string }[] })?.apps || []) as { status?: string }[];
  const website = sections.filter((x) => x.group === "Website");

  const titleOf = (id: string) => sections.find((x) => x.id === id)?.title || id;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <p className="eyebrow">Dashboard</p>
      <h1 className="mt-2 text-3xl font-medium tracking-[-0.03em] sm:text-4xl">Hello, {s.name?.split(" ")[0] || s.login}.</h1>
      <p className="mt-2 text-sm text-white/55">
        Edit anything on{" "}
        <a href={env.siteUrl} target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">
          {env.siteUrl.replace(/^https?:\/\//, "")}
        </a>
        . Saving publishes automatically in about a minute.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="eyebrow">Placeholders left</p>
          <p className="mt-2 text-4xl font-medium tracking-[-0.03em]">{required.length}</p>
          <p className="mt-1 text-xs text-white/45">Sample content and stand-in images</p>
        </div>
        <div className="card p-5">
          <p className="eyebrow">Optional extras</p>
          <p className="mt-2 text-4xl font-medium tracking-[-0.03em]">{optional.length}</p>
          <p className="mt-1 text-xs text-white/45">Nice to have, not required</p>
        </div>
        <Link href="/saas" className="card group p-5 transition-colors hover:border-white/25">
          <p className="eyebrow flex items-center gap-2">
            <Boxes className="h-3.5 w-3.5" aria-hidden /> SaaS apps
          </p>
          <p className="mt-2 text-4xl font-medium tracking-[-0.03em]">{apps.length}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-white/45 group-hover:text-white">
            {apps.filter((a) => a.status === "Live").length} live · open directory <ArrowUpRight className="h-3 w-3" aria-hidden />
          </p>
        </Link>
      </div>

      <section className="mt-10" aria-labelledby="todo-title">
        <h2 id="todo-title" className="flex items-center gap-2 text-lg font-medium">
          <Sparkles className="h-4 w-4 text-tungsten" aria-hidden /> Still to fill in
        </h2>
        {required.length === 0 ? (
          <p className="card mt-4 p-5 text-sm text-ok">Everything is filled in. Nice work.</p>
        ) : (
          <ul className="card mt-4 divide-y divide-white/5">
            {required.map((t, i) => (
              <li key={i}>
                <Link href={`/edit/${t.section}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-white/[0.03]">
                  {t.kind === "missing" ? (
                    <CircleDashed className="h-4 w-4 shrink-0 text-bad" aria-hidden />
                  ) : (
                    <ImageOff className="h-4 w-4 shrink-0 text-tungsten" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <span className="hidden shrink-0 text-xs text-white/40 sm:inline">{titleOf(t.section)}</span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {optional.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-white/50 hover:text-white">Optional extras ({optional.length})</summary>
            <ul className="mt-2 space-y-1 pl-4">
              {optional.map((t, i) => (
                <li key={i}>
                  <Link href={`/edit/${t.section}`} className="text-white/60 underline-offset-4 hover:text-white hover:underline">
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="mt-12" aria-labelledby="sections-title">
        <h2 id="sections-title" className="text-lg font-medium">
          Website sections
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...website, ...sections.filter((x) => x.group === "Settings")].map((sec) => {
            const n = todos.filter((t) => t.section === sec.id && t.kind !== "optional").length;
            return (
              <Link key={sec.id} href={`/edit/${sec.id}`} className="card group flex flex-col p-5 transition-colors hover:border-white/25">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{sec.title}</span>
                  {n > 0 && <span className="pill bg-tungsten/15 text-tungsten">{n} to do</span>}
                </span>
                <span className="mt-2 text-xs leading-relaxed text-white/45">{sec.description}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
