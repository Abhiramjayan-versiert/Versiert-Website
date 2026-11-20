"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, RotateCcw, Save } from "lucide-react";
import type { Section } from "@/lib/schema";
import { deployStatusAction, reloadSectionAction, saveSectionAction } from "@/app/actions";
import { FieldView, StagingContext, type Staged } from "./Fields";

type Publish =
  | { state: "idle" }
  | { state: "saved-local" }
  | { state: "publishing"; commitUrl?: string; deployUrl?: string }
  | { state: "live"; commitUrl?: string }
  | { state: "failed"; commitUrl?: string; deployUrl?: string }
  | { state: "unknown"; commitUrl?: string };

export function SectionEditor({
  section,
  initial,
  initialSha,
  siteUrl,
  isSaas,
  readOnlyReason,
}: {
  section: Section;
  initial: unknown;
  initialSha: string | null;
  siteUrl: string;
  isSaas?: boolean;
  readOnlyReason?: string;
}) {
  const [value, setValue] = useState<unknown>(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [sha, setSha] = useState(initialSha);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ msg: string; list?: string[]; conflict?: boolean } | null>(null);
  const [publish, setPublish] = useState<Publish>({ state: "idle" });
  const staged = useRef(new Map<string, Staged>());
  const [, bump] = useState(0);

  const json = JSON.stringify(value);
  const dirty = json !== saved;

  // Warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const ctx = useMemo(
    () => ({
      stage: (img: Staged) => {
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        staged.current.set(id, img);
        bump((n) => n + 1);
        return id;
      },
      get: (id: string) => staged.current.get(id),
      categories:
        section.id === "work" && value && typeof value === "object" && Array.isArray((value as { categories?: unknown }).categories)
          ? ((value as { categories: string[] }).categories.filter(Boolean) as string[])
          : [],
    }),
    [section.id, value],
  );

  const pollDeploy = useCallback(async (commitSha: string, commitUrl?: string) => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 6000 : 5000));
      const st = await deployStatusAction(commitSha).catch(() => ({ state: "unknown" as const }));
      if (st.state === "success") return setPublish({ state: "live", commitUrl });
      if (st.state === "failure") return setPublish({ state: "failed", commitUrl, deployUrl: "url" in st ? st.url : undefined });
      if (st.state === "pending") setPublish({ state: "publishing", commitUrl, deployUrl: "url" in st ? st.url : undefined });
    }
    setPublish({ state: "unknown", commitUrl });
  }, []);

  const save = useCallback(async () => {
    if (saving || readOnlyReason) return;
    setSaving(true);
    setError(null);
    const used = [...json.matchAll(/pending:([a-z0-9]{6,40})/gi)].map((m) => m[1]);
    const images = [...new Set(used)].flatMap((id) => {
      const s = staged.current.get(id);
      return s ? [{ id, data: s.data, name: s.name }] : [];
    });
    try {
      const res = await saveSectionAction({ sectionId: section.id, value, baseSha: sha, images });
      if (!res.ok) {
        setError({ msg: res.error, list: res.errors, conflict: res.conflict });
        return;
      }
      setValue(res.value);
      setSaved(JSON.stringify(res.value));
      setSha(res.sha);
      staged.current.clear();
      if (res.commitSha && !isSaas) {
        setPublish({ state: "publishing", commitUrl: res.commitUrl });
        pollDeploy(res.commitSha, res.commitUrl);
      } else {
        setPublish({ state: "saved-local" });
      }
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : "Save failed. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }, [saving, readOnlyReason, json, section.id, value, sha, isSaas, pollDeploy]);

  // Ctrl/Cmd + S
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [dirty, save]);

  const reload = async () => {
    const r = await reloadSectionAction(section.id);
    if (r) {
      setValue(r.value);
      setSaved(JSON.stringify(r.value));
      setSha(r.sha);
      setError(null);
    } else {
      location.reload();
    }
  };

  const single = section.fields.length === 1 && section.fields[0].key === "";
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;

  return (
    <StagingContext.Provider value={ctx}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="pb-32"
      >
        {readOnlyReason && (
          <p role="alert" className="mb-6 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
            {readOnlyReason}
          </p>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-7">
          {single ? (
            <FieldView field={{ ...section.fields[0], label: "" }} value={value} onChange={setValue} />
          ) : (
            section.fields.map((f) => <FieldView key={f.key} field={f} value={obj[f.key]} onChange={(v) => setValue({ ...obj, [f.key]: v })} />)
          )}
        </div>

        {/* Sticky save bar */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0a0a0a]/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="min-w-0 text-sm" aria-live="polite">
              {error ? (
                <div className="text-bad">
                  <p className="flex items-center gap-2">
                    <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
                    {error.msg}
                    {error.conflict && (
                      <button type="button" className="underline underline-offset-4" onClick={reload}>
                        Load latest
                      </button>
                    )}
                  </p>
                  {error.list && (
                    <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-9 text-xs">
                      {error.list.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : dirty ? (
                <p className="flex items-center gap-2 text-tungsten">
                  <span className="h-2 w-2 rounded-full bg-tungsten" aria-hidden /> Unsaved changes
                </p>
              ) : publish.state === "publishing" ? (
                <p className="flex items-center gap-2 text-white/70">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saved. Publishing to the website (about a minute)…
                  {publish.commitUrl && (
                    <a href={publish.commitUrl} target="_blank" rel="noopener noreferrer" className="text-white/45 underline underline-offset-4">
                      commit
                    </a>
                  )}
                </p>
              ) : publish.state === "live" ? (
                <p className="flex items-center gap-2 text-ok">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Live on the website.
                  <a href={`${siteUrl}/${section.anchor || ""}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                    View <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                </p>
              ) : publish.state === "failed" ? (
                <p className="flex items-center gap-2 text-bad">
                  <CircleAlert className="h-4 w-4" aria-hidden /> Saved, but the website build failed. The previous version stays live.
                  {publish.deployUrl && (
                    <a href={publish.deployUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      Build log
                    </a>
                  )}
                </p>
              ) : publish.state === "unknown" ? (
                <p className="text-white/60">Saved. Publishing status unavailable; check the website in a minute.</p>
              ) : publish.state === "saved-local" ? (
                <p className="flex items-center gap-2 text-ok">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Saved.
                </p>
              ) : (
                <p className="text-white/40">All changes saved.</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!dirty || saving}
                onClick={() => {
                  setValue(JSON.parse(saved));
                  setError(null);
                }}
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Discard
              </button>
              <button type="submit" className="btn btn-primary min-w-32" disabled={!dirty || saving || Boolean(readOnlyReason)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                {saving ? "Saving…" : isSaas ? "Save" : "Save & publish"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </StagingContext.Provider>
  );
}
