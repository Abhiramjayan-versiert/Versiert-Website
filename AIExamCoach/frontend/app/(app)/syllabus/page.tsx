"use client";
import { GraduationCap, Plus, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TaskStatus, useTask } from "@/components/TaskStatus";
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

const STATUS = ["pending", "in_progress", "completed"];

function DraftEditor({ draft, onApply, onDiscard }: { draft: any; onApply: (data: any, date?: string) => void; onDiscard: () => void }) {
  const [data, setData] = useState<any>(structuredClone(draft.data));
  const [date, setDate] = useState<string>("");
  const upd = (fn: (d: any) => void) => { const c = structuredClone(data); fn(c); setData(c); };
  return (
    <div className="space-y-4">
      {draft.warnings?.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><strong>Checks:</strong><ul className="mt-1 list-disc pl-4">{draft.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></div>}
      {data.subjects.map((s: any, si: number) => (
        <div key={si} className="rounded-xl border hairline p-3">
          <div className="flex gap-2">
            <input value={s.name} onChange={(e) => upd((d) => { d.subjects[si].name = e.target.value; })} aria-label="Subject name" />
            <input className="!w-28" type="number" placeholder="marks" value={s.total_marks ?? ""} onChange={(e) => upd((d) => { d.subjects[si].total_marks = e.target.value ? Number(e.target.value) : null; })} aria-label="Total marks" />
            <Button size="sm" variant="danger" onClick={() => upd((d) => { d.subjects.splice(si, 1); })}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
          {s.units.map((u: any, ui: number) => (
            <div key={ui} className="mt-3 border-l-2 hairline pl-3">
              <div className="flex gap-2">
                <input value={u.name} onChange={(e) => upd((d) => { d.subjects[si].units[ui].name = e.target.value; })} aria-label="Unit name" className="!font-medium" />
                <input className="!w-24" type="number" placeholder="marks" value={u.marks ?? ""} onChange={(e) => upd((d) => { d.subjects[si].units[ui].marks = e.target.value ? Number(e.target.value) : null; })} aria-label="Unit marks" />
                <Button size="sm" variant="ghost" onClick={() => upd((d) => { d.subjects[si].units.splice(ui, 1); })}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              <ul className="mt-2 space-y-1.5">
                {u.topics.map((t: any, ti: number) => (
                  <li key={ti} className="flex items-center gap-2">
                    <input value={t.name} onChange={(e) => upd((d) => { d.subjects[si].units[ui].topics[ti].name = e.target.value; })} aria-label="Topic" className="!py-1 !text-xs" />
                    <select className="!w-24 !py-1 !text-xs" value={t.importance ?? "normal"} onChange={(e) => upd((d) => { d.subjects[si].units[ui].topics[ti].importance = e.target.value; })} aria-label="Importance"><option value="high">high</option><option value="normal">normal</option><option value="low">low</option></select>
                    <button aria-label="Remove topic" onClick={() => upd((d) => { d.subjects[si].units[ui].topics.splice(ti, 1); })}><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
              <button className="muted mt-1 text-xs underline" onClick={() => upd((d) => { d.subjects[si].units[ui].topics.push({ name: "New topic", subtopics: [], key_concepts: [], prerequisites: [], importance: "normal" }); })}>+ topic</button>
            </div>
          ))}
        </div>
      ))}
      {draft.data.exam_dates_in_text?.length > 0 && (
        <Field label="Exam date found in the document — set it on the profile?">
          <select value={date} onChange={(e) => setDate(e.target.value)}><option value="">Don't change</option>{draft.data.exam_dates_in_text.map((d: string) => <option key={d} value={d}>{d}</option>)}</select>
        </Field>
      )}
      <div className="flex justify-end gap-2"><Button variant="danger" onClick={onDiscard}>Discard</Button><Button variant="primary" onClick={() => onApply(data, date || undefined)}>Apply to syllabus</Button></div>
    </div>
  );
}

export default function Syllabus() {
  const { pid } = useApp();
  const [tree, setTree] = useState<any[] | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [topicEdit, setTopicEdit] = useState<any | null>(null);
  const [openDraft, setOpenDraft] = useState<any | null>(null);
  const [newSubject, setNewSubject] = useState("");

  const load = async () => {
    if (!pid) return;
    const [t, d, dr] = await Promise.all([api.get(`/api/profiles/${pid}/syllabus`), api.get(`/api/profiles/${pid}/documents`), api.get(`/api/profiles/${pid}/syllabus/drafts`)]);
    setTree(t); setDocs(d); setDrafts(dr);
    const want = new URLSearchParams(window.location.search).get("draft");
    if (want) setOpenDraft(dr.find((x: any) => String(x.id) === want && x.status === "draft") ?? null);
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [pid]);
  const task = useTask(taskId, async (t) => { setTaskId(null); await load(); if (t.result_ref?.draft_id) { const dr = await api.get(`/api/profiles/${pid}/syllabus/drafts`); setOpenDraft(dr.find((x: any) => x.id === t.result_ref.draft_id)); } });

  const analyse = async (docId: number) => { setErr(null); try { setTaskId((await api.post(`/api/profiles/${pid}/syllabus/analyze/${docId}`)).task_id); } catch (e: any) { setErr(e.message); } };
  const setStatus = async (t: any, status: string) => { await api.patch(`/api/profiles/${pid}/syllabus/topics/${t.id}`, { status }); load(); };
  const saveTopic = async () => {
    const { id, subject_id, ...rest } = topicEdit;
    const body = { ...rest, marks_weight: rest.marks_weight === "" || rest.marks_weight == null ? null : Number(rest.marks_weight), difficulty: Number(rest.difficulty), est_hours: Number(rest.est_hours) };
    try {
      if (id) await api.patch(`/api/profiles/${pid}/syllabus/topics/${id}`, body);
      else await api.post(`/api/profiles/${pid}/syllabus/topics`, { ...body, subject_id });
      setTopicEdit(null); load();
    } catch (e: any) { setErr(e.message); }
  };

  if (!tree) return <Spinner />;
  const syllabusDocs = docs.filter((d) => ["indexed", "extracted"].includes(d.status));
  const pending = drafts.filter((d) => d.status === "draft");
  return (
    <>
      <PageHeader title="Syllabus" subtitle="Subjects, units and topics for this examination. Extracted items are verified against your document and stay editable." />
      <ErrorNote error={err} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {!tree.length && <Empty title="No syllabus yet">Upload your syllabus in the Document Library, then run the Syllabus Analyst on the right — or add subjects manually.</Empty>}
          {tree.map((s) => {
            const units = s.topics.filter((t: any) => t.kind === "unit");
            const loose = s.topics.filter((t: any) => t.kind !== "unit" && !units.some((u: any) => u.id === t.parent_id));
            const groups = [...units.map((u: any) => ({ unit: u, topics: s.topics.filter((t: any) => t.parent_id === u.id) })), ...(loose.length ? [{ unit: null, topics: loose }] : [])];
            const done = s.topics.filter((t: any) => t.kind !== "unit" && t.status === "completed").length;
            const total = s.topics.filter((t: any) => t.kind !== "unit").length;
            return (
              <Card key={s.id} title={<>{s.name} {s.total_marks && <span className="muted font-normal">· {s.total_marks} marks</span>} <span className="muted font-normal">· {done}/{total} done</span></>}
                action={<div className="flex gap-1"><Button size="sm" onClick={() => setTopicEdit({ subject_id: s.id, name: "", kind: "topic", difficulty: 3, importance: "normal", est_hours: 2, marks_weight: "", key_concepts: "", prerequisites: "" })}><Plus className="h-3.5 w-3.5" /> Topic</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Delete subject "${s.name}" and its topics?`)) { await api.del(`/api/profiles/${pid}/syllabus/subjects/${s.id}`); load(); } }}><Trash2 className="h-3.5 w-3.5" /></Button></div>}>
                {groups.map((g, gi) => (
                  <div key={gi} className="mb-3">
                    {g.unit && <div className="mb-1.5 text-xs font-semibold">{g.unit.name}{g.unit.marks_weight ? <span className="muted font-normal"> · {g.unit.marks_weight} marks</span> : null}</div>}
                    <ul className="divide-y hairline">
                      {g.topics.map((t: any) => (
                        <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                          <button className="flex-1 text-left hover:underline" onClick={() => setTopicEdit({ ...t, marks_weight: t.marks_weight ?? "" })}>{t.name}</button>
                          {t.importance === "high" && <Badge tone="accent">high weightage</Badge>}
                          {t.marks_weight && <span className="muted text-xs">{t.marks_weight}m</span>}
                          <Link href={`/tutor/?topic=${encodeURIComponent(t.name)}`} title="Learn with the AI Tutor"><GraduationCap className="h-4 w-4" /></Link>
                          <select aria-label="Status" value={t.status} onChange={(e) => setStatus(t, e.target.value)} className="!w-32 !py-1 !text-xs">{STATUS.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}</select>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </Card>
            );
          })}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!newSubject.trim()) return; await api.post(`/api/profiles/${pid}/syllabus/subjects`, { name: newSubject }); setNewSubject(""); load(); }}>
            <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Add a subject manually" />
            <Button type="submit"><Plus className="h-4 w-4" /> Subject</Button>
          </form>
        </div>

        <div className="space-y-4">
          <Card title="Syllabus Analyst">
            <p className="muted mb-3 text-xs">Extracts subjects, units, topics and marks. Anything not found in the document is dropped — nothing is guessed.</p>
            {taskId ? <TaskStatus task={task} /> : syllabusDocs.length ? (
              <ul className="space-y-2">{syllabusDocs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{d.display_name} {d.category === "syllabus" && <Badge>syllabus</Badge>}</span><Button size="sm" onClick={() => analyse(d.id)}><Wand2 className="h-3.5 w-3.5" /> Analyse</Button></li>
              ))}</ul>
            ) : <Empty title="No processed documents">Upload a syllabus in the <Link href="/documents/" className="underline">Document Library</Link>.</Empty>}
          </Card>
          {pending.length > 0 && (
            <Card title="Drafts awaiting review">
              <ul className="space-y-2 text-sm">{pending.map((d) => <li key={d.id} className="flex items-center justify-between"><span>Draft #{d.id} · {d.data.subjects?.length ?? 0} subjects</span><Button size="sm" variant="primary" onClick={() => setOpenDraft(d)}>Review</Button></li>)}</ul>
            </Card>
          )}
        </div>
      </div>

      <Modal open={!!openDraft} onClose={() => setOpenDraft(null)} title="Review extracted syllabus" wide>
        {openDraft && <DraftEditor draft={openDraft}
          onApply={async (data, date) => { try { const r = await api.post(`/api/profiles/${pid}/syllabus/drafts/${openDraft.id}/apply`, { data, set_exam_date: date }); setOpenDraft(null); await load(); alert(`Added ${r.subjects} subject(s) and ${r.topics} topic(s).`); } catch (e: any) { setErr(e.message); } }}
          onDiscard={async () => { await api.post(`/api/profiles/${pid}/syllabus/drafts/${openDraft.id}/discard`); setOpenDraft(null); load(); }} />}
      </Modal>

      <Modal open={!!topicEdit} onClose={() => setTopicEdit(null)} title={topicEdit?.id ? "Edit topic" : "Add topic"}>
        {topicEdit && (
          <div className="space-y-3">
            <Field label="Topic name"><input value={topicEdit.name} onChange={(e) => setTopicEdit({ ...topicEdit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Marks weight"><input type="number" value={topicEdit.marks_weight} onChange={(e) => setTopicEdit({ ...topicEdit, marks_weight: e.target.value })} /></Field>
              <Field label="Difficulty (1-5)"><input type="number" min={1} max={5} value={topicEdit.difficulty} onChange={(e) => setTopicEdit({ ...topicEdit, difficulty: e.target.value })} /></Field>
              <Field label="Est. hours"><input type="number" min={0.25} step={0.25} value={topicEdit.est_hours} onChange={(e) => setTopicEdit({ ...topicEdit, est_hours: e.target.value })} /></Field>
            </div>
            <Field label="Importance"><select value={topicEdit.importance} onChange={(e) => setTopicEdit({ ...topicEdit, importance: e.target.value })}><option value="high">High weightage</option><option value="normal">Normal</option><option value="low">Low</option></select></Field>
            <Field label="Key concepts / subtopics"><textarea rows={2} value={topicEdit.key_concepts} onChange={(e) => setTopicEdit({ ...topicEdit, key_concepts: e.target.value })} /></Field>
            <Field label="Prerequisites"><input value={topicEdit.prerequisites} onChange={(e) => setTopicEdit({ ...topicEdit, prerequisites: e.target.value })} /></Field>
            <div className="flex justify-between gap-2">
              {topicEdit.id ? <Button variant="danger" onClick={async () => { await api.del(`/api/profiles/${pid}/syllabus/topics/${topicEdit.id}`); setTopicEdit(null); load(); }}>Delete</Button> : <span />}
              <div className="flex gap-2"><Button onClick={() => setTopicEdit(null)}>Cancel</Button><Button variant="primary" onClick={saveTopic} disabled={!topicEdit.name.trim()}>Save</Button></div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
