import Link from "next/link";
import { Code2, Database, ExternalLink, LayoutDashboard, Pencil, Server } from "lucide-react";
import { SaasGrid, type App } from "@/components/SaasGrid";
import { requireSession } from "@/lib/session";
import { loadSaas } from "@/lib/store";

export const metadata = { title: "SaaS apps" };

export default async function SaasPage() {
  const s = await requireSession();
  const saas = await loadSaas(s);
  const apps = ((saas.data as { apps?: App[] }).apps || []) as App[];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.03em] sm:text-4xl">SaaS apps</h1>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Every app you run: what it's for, who uses it, and where everything lives. Private to you.
          </p>
        </div>
        <Link href="/edit/saas" className="btn btn-primary">
          <Pencil className="h-4 w-4" aria-hidden /> Edit apps
        </Link>
      </div>

      {saas.problem && (
        <div role="alert" className="mt-6 rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
          <p className="font-medium">Storage needs setting up</p>
          <p className="mt-1">{saas.problem}</p>
          <p className="mt-2 text-white/60">Until then, the list below shows the starting data from your Vercel projects.</p>
        </div>
      )}
      {saas.isSeed && !saas.problem && (
        <p className="mt-6 rounded-xl border border-tungsten/30 bg-tungsten/5 px-4 py-3 text-sm text-tungsten">
          Pre-filled from your Vercel projects. Click “Edit apps” to add what each one is for and save it.
        </p>
      )}

      <SaasGrid
        apps={apps}
        icons={{
          live: <ExternalLink className="h-3.5 w-3.5" aria-hidden />,
          admin: <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />,
          repo: <Code2 className="h-3.5 w-3.5" aria-hidden />,
          hosting: <Server className="h-3.5 w-3.5" aria-hidden />,
          db: <Database className="h-3.5 w-3.5" aria-hidden />,
        }}
      />
    </div>
  );
}
