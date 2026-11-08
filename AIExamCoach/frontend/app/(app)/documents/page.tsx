"use client";
import { Download, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { useApp } from "@/lib/app-context";

const CATS: [string, string][] = [["syllabus", "Syllabus"], ["textbook", "Textbook"], ["notes", "Notes"], ["past_paper", "Previous question paper"], ["marking_scheme", "Marking scheme"], ["other", "Other"]];
const TONE: Record<string, any> = { indexed: "accent", failed: "danger", extracted: "warn", queued: "neutral", processing: "neutral" };

export default function Documents() {
  const { pid } = useApp();
  const [docs, setDocs] = useState<any[] | null>(null);
  const [tree, setTree] = useState<any[]>([]);
  const [cat, setCat] = useState("textbook");
  const [subj, setSubj] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [view, setView] = useState<any | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<number | null>(null);

  const load = () => api.get(`/api/profiles/${pid}/documents`).then(setDocs).catch((e) => setErr(e.message));
  useEffect(() => { if (pid) { load(); api.get(`/api/profiles/${pid}/syllabus`).then(setTree); } }, [pid]);
  useEffect(() => {
    if (!docs?.some((d) => ["queued", "processing"].includes(d.status))) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [docs]);

  const upload = async (files: FileList) => {
    setErr(null);
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try {
        const fd = new FormData();
        fd.append("file", f); fd.append("category", cat);
        if (subj) fd.append("subject_id", subj);
        await api.upload(`/api/profiles/${pid}/documents`, fd);
      } catch (e: any) { setErr(`${f.name}: ${e.message}`); }
    }
    setUploading(null);
    load();
  };
  const replace = async (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    try { await api.upload(`/api/profiles/${pid}/documents/${replacing}/replace`, fd); } catch (e: any) { setErr(e.message); }
    setReplacing(null); load();
  };
  const search = async () => { if (q.trim().length < 2) return; try { setHits(await api.get(`/api/profiles/${pid}/documents-search?q=${encodeURIComponent(q)}`)); } catch (e: any) { setErr(e.message); } };
  const subjName = (id: number | null) => tree.find((s) => s.id === id)?.name;

  return (
    <>
      <PageHeader title="Document Library" subtitle="PDF, DOCX, PPTX, XLSX, CSV, TXT, JPG and PNG. Everything is processed on this PC (text extraction, local OCR, EmbeddingGemma) and stored in this exam profile only."
        action={<Button onClick={async () => { for (const d of docs ?? []) await api.post(`/api/profiles/${pid}/documents/${d.id}/reindex`); load(); }}><RefreshCw className="h-4 w-4" /> Re-index all</Button>} />
      <ErrorNote error={err} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Card>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your documents (semantic + keyword)" />
              <Button type="submit"><Search className="h-4 w-4" /></Button>
            </form>
            {hits && (
              <ul className="mt-3 space-y-2">{hits.length ? hits.map((h) => (
                <li key={h.chunk_id} className="rounded-lg subtle p-3 text-sm"><div className="mb-1 text-xs font-semibold">{h.filename}{h.page ? `, page ${h.page}` : h.section ? `, ${h.section}` : ""} <span className="muted font-normal">· relevance {h.score}</span></div><p className="line-clamp-4 whitespace-pre-wrap">{h.text}</p></li>
              )) : <li className="muted text-sm">No matching passages.</li>}</ul>
            )}
          </Card>
          {!docs ? <Spinner /> : !docs.length ? <Empty title="No documents yet">Upload your syllabus, textbooks, notes, previous papers and marking schemes.</Empty> : (
            <ul className="space-y-2">
              {docs.map((d) => (
                <li key={d.id} className="card flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.display_name}</div>
                    <div className="muted text-xs">{d.file_type.toUpperCase()} · {(d.size_bytes / 1e6).toFixed(2)} MB · {d.pages ? `${d.pages} pages · ` : ""}{d.chunk_count} chunks{d.ocr_pages ? ` · ${d.ocr_pages} OCR page(s)` : ""} · {fmtDate(d.uploaded_at)}</div>
                    {d.error && <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">{d.error}</div>}
                  </div>
                  <Badge>{CATS.find((c) => c[0] === d.category)?.[1]}</Badge>
                  {subjName(d.subject_id) && <Badge>{subjName(d.subject_id)}</Badge>}
                  <Badge tone={TONE[d.status]}>{d.status}</Badge>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...d, subject_id: d.subject_id ?? "" })}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={async () => setView({ doc: d, chunks: await api.get(`/api/profiles/${pid}/documents/${d.id}/chunks`) })}>Text</Button>
                    <a href={`/api/profiles/${pid}/documents/${d.id}/file`} aria-label="Download"><Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /></Button></a>
                    <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/api/profiles/${pid}/documents/${d.id}/reindex`); load(); }} aria-label="Re-index"><RefreshCw className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Permanently delete "${d.display_name}" and its search index?`)) { await api.del(`/api/profiles/${pid}/documents/${d.id}?confirm=true`); load(); } }} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card title={<span className="flex items-center gap-2"><Upload className="h-4 w-4" /> Upload</span>}>
          <div className="space-y-3">
            <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Subject (optional)"><select value={subj} onChange={(e) => setSubj(e.target.value)}><option value="">—</option>{tree.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.jpg,.jpeg,.png" onChange={(e) => e.target.files && upload(e.target.files)} />
            <input ref={replaceRef} type="file" hidden accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])} />
            <Button variant="primary" className="w-full" loading={!!uploading} onClick={() => fileRef.current?.click()}>{uploading ? `Uploading ${uploading}…` : "Choose files"}</Button>
            <p className="muted text-[11px]">Large PDFs are processed page by page in the background. Scanned pages are read with local Tesseract OCR.</p>
          </div>
        </Card>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit document">
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><input value={edit.display_name} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} /></Field>
            <Field label="Category"><select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Subject"><select value={edit.subject_id} onChange={(e) => setEdit({ ...edit, subject_id: e.target.value })}><option value="">—</option>{tree.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <div className="flex justify-between gap-2">
              <Button onClick={() => { setReplacing(edit.id); setEdit(null); replaceRef.current?.click(); }}>Replace file…</Button>
              <Button variant="primary" onClick={async () => { await api.patch(`/api/profiles/${pid}/documents/${edit.id}`, { display_name: edit.display_name, category: edit.category, subject_id: edit.subject_id ? Number(edit.subject_id) : null, clear_subject: !edit.subject_id }); setEdit(null); load(); }}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} title={view?.doc.display_name ?? ""} wide>
        {view && <div className="space-y-3">{view.chunks.map((c: any) => <div key={c.id} className="rounded-lg subtle p-3 text-sm"><div className="muted mb-1 text-[11px]">{c.page ? `Page ${c.page}` : c.section || "—"} · chunk {c.idx + 1}</div><p className="whitespace-pre-wrap">{c.text}</p></div>)}</div>}
      </Modal>
    </>
  );
}
