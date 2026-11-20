import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { SectionEditor } from "@/components/SectionEditor";
import { env } from "@/lib/env";
import { sectionById } from "@/lib/schema";
import { requireSession } from "@/lib/session";
import { loadContent, loadSaas } from "@/lib/store";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = sectionById((await params).id);
  return { title: s?.title || "Edit" };
}

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const section = sectionById(id);
  if (!section) notFound();
  const session = await requireSession();

  let initial: unknown;
  let sha: string | null;
  let readOnly: string | undefined;
  let note: string | undefined;
  if (section.file === "saas") {
    const s = await loadSaas(session);
    initial = (s.data as { apps?: unknown }).apps ?? [];
    sha = s.sha;
    readOnly = s.problem;
    if (s.isSeed && !s.problem) note = "Pre-filled from your Vercel projects. Nothing is stored until you save.";
  } else {
    const f = await loadContent(section.file, session);
    initial = section.path ? f.data[section.path] : f.data;
    sha = f.sha;
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <Link href={section.file === "saas" ? "/saas" : "/"} className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {section.file === "saas" ? "SaaS apps" : "Dashboard"}
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{section.group}</p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.03em] sm:text-4xl">{section.title}</h1>
          <p className="mt-2 max-w-xl text-sm text-white/55">{section.description}</p>
        </div>
        {section.group === "Website" && (
          <a href={`${env.siteUrl}/${section.anchor || ""}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            View on site <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
      {note && <p className="mt-6 rounded-xl border border-tungsten/30 bg-tungsten/5 px-4 py-3 text-sm text-tungsten">{note}</p>}
      <div className="mt-8">
        <SectionEditor
          key={section.id}
          section={section}
          initial={initial}
          initialSha={sha}
          siteUrl={env.siteUrl}
          isSaas={section.file === "saas"}
          readOnlyReason={readOnly}
        />
      </div>
    </div>
  );
}
