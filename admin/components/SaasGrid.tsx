"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

export type App = {
  id: string;
  name: string;
  status: string;
  purpose: string;
  users: string;
  liveUrl: string;
  adminUrl: string;
  repoUrl: string;
  hosting: string;
  database: string;
  stack: string[];
  links: { label: string; url: string }[];
  notes: string;
};

const STATUS: Record<string, string> = {
  Live: "bg-ok/15 text-ok",
  "In development": "bg-tungsten/15 text-tungsten",
  Paused: "bg-white/10 text-white/70",
  Archived: "bg-white/5 text-white/40",
};
const FILTERS = ["All", "Live", "In development", "Paused", "Archived"];

export function SaasGrid({ apps, icons }: { apps: App[]; icons: Record<"live" | "admin" | "repo" | "hosting" | "db", React.ReactNode> }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState("All");
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return apps.filter(
      (a) =>
        (f === "All" || a.status === f) &&
        (!term || [a.name, a.purpose, a.users, a.notes, a.hosting, a.database, ...(a.stack || [])].join(" ").toLowerCase().includes(term)),
    );
  }, [apps, q, f]);

  const linkBtn = (href: string, label: string, icon: React.ReactNode) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-8 px-3 text-xs">
        {icon} {label}
      </a>
    ) : null;

  return (
    <>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search apps</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
          <input className="input pl-9" placeholder="Search name, purpose, users, stack…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {FILTERS.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={f === x}
              onClick={() => setF(x)}
              className={`h-9 rounded-full border px-3 text-xs transition-colors ${f === x ? "border-white bg-white text-black" : "border-white/15 text-white/65 hover:border-white/40"}`}
            >
              {x}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="card mt-6 p-8 text-center text-sm text-white/50">No apps match.</p>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <li key={a.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-medium tracking-[-0.02em]">{a.name}</h2>
                <span className={`pill shrink-0 ${STATUS[a.status] || STATUS.Paused}`}>{a.status}</span>
              </div>
              <p className={`mt-2 text-sm leading-relaxed ${a.purpose ? "text-white/70" : "italic text-white/35"}`}>
                {a.purpose || "What it's used for: not filled in yet"}
              </p>
              {a.users && (
                <p className="mt-2 text-xs text-white/50">
                  <span className="text-white/35">Used by:</span> {a.users}
                </p>
              )}
              <dl className="mt-4 space-y-1.5 text-xs text-white/55">
                {a.hosting && (
                  <div className="flex items-center gap-2">
                    <dt className="text-white/35">{icons.hosting}</dt>
                    <dd className="sr-only">Hosting</dd>
                    <dd>{a.hosting}</dd>
                  </div>
                )}
                {a.database && (
                  <div className="flex items-center gap-2">
                    <dt className="text-white/35">{icons.db}</dt>
                    <dd className="sr-only">Database</dd>
                    <dd>{a.database}</dd>
                  </div>
                )}
              </dl>
              {a.stack?.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tech stack">
                  {a.stack.map((t) => (
                    <li key={t} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[0.65rem] text-white/55">
                      {t}
                    </li>
                  ))}
                </ul>
              )}
              {a.notes && <p className="mt-3 line-clamp-3 border-l border-white/15 pl-3 text-xs leading-relaxed text-white/50">{a.notes}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                {linkBtn(a.liveUrl, "Open app", icons.live)}
                {linkBtn(a.adminUrl, "Admin", icons.admin)}
                {linkBtn(a.repoUrl, "Code", icons.repo)}
                {a.links?.map((l) => (
                  <a key={l.url + l.label} href={l.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost h-8 px-3 text-xs">
                    {l.label}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-white/35">
        {apps.length} apps · <Link href="/edit/saas" className="underline underline-offset-4 hover:text-white">edit details</Link>
      </p>
    </>
  );
}
