"use client";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, Modal, PageHeader, Progress, confirmText } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { Profile, useApp } from "@/lib/app-context";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const blank = { name: "", exam_type: "other", exam_date: "", target_pct: 75, daily_hours: 3, study_days: [0, 1, 2, 3, 4, 5], notes: "" };

export default function Exams() {
  const { pid, setActive, refresh } = useApp();
  const [list, setList] = useState<Profile[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.get(`/api/profiles?include_archived=${showArchived}`).then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [showArchived]);

  const save = async () => {
    setErr(null);
    try {
      const body = { ...edit, exam_date: edit.exam_date || null, target_pct: Number(edit.target_pct), daily_hours: Number(edit.daily_hours) };
      if (edit.id) await api.patch(`/api/profiles/${edit.id}`, { ...body, clear_exam_date: !edit.exam_date });
      else await api.post("/api/profiles", body);
      setEdit(null);
      await Promise.all([load(), refresh()]);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const remove = async (p: Profile) => {
    if (!confirmText(`Permanently delete "${p.name}" and ALL its syllabus, documents, plans, questions, mocks and scores?`, p.name)) return;
    await api.del(`/api/profiles/${p.id}?confirm=${encodeURIComponent(p.name)}`);
    await Promise.all([load(), refresh()]);
  };

  return (
    <>
      <PageHeader title="My Examinations" subtitle="Each examination keeps its own syllabus, documents, plan, questions, scores and revision history."
        action={<><Button onClick={() => setShowArchived(!showArchived)}><Archive className="h-4 w-4" />{showArchived ? "Hide archived" : "Show archived"}</Button>
          <Button variant="primary" onClick={() => setEdit({ ...blank })}><Plus className="h-4 w-4" /> New examination</Button></>} />
      <ErrorNote error={err} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => (
          <Card key={p.id} title={<span className="flex items-center gap-2">{p.name}{p.archived && <Badge>archived</Badge>}{p.id === pid && <Badge tone="accent">active</Badge>}</span>}>
            <div className="muted space-y-1 text-sm">
              <div>{p.exam_type.toUpperCase()} · target {p.target_pct}% · {p.daily_hours} h/day</div>
              <div>{p.exam_date ? `${fmtDate(p.exam_date)} (${p.days_left} days)` : "No exam date set"}</div>
              <div>{p.subjects} subjects · {p.topics} topics · {p.documents} documents · {p.mocks} mocks</div>
            </div>
            <Progress className="mt-3" value={p.topics ? (100 * p.topics_completed) / p.topics : 0} />
            <div className="mt-4 flex flex-wrap gap-2">
              {p.id !== pid && !p.archived && <Button size="sm" variant="primary" onClick={() => setActive(p.id).then(() => (window.location.href = "/"))}>Switch to</Button>}
              <Button size="sm" onClick={() => setEdit({ ...p, exam_date: p.exam_date ?? "" })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
              <Button size="sm" onClick={async () => { await api.patch(`/api/profiles/${p.id}`, { archived: !p.archived }); load(); refresh(); }}>{p.archived ? "Unarchive" : "Archive"}</Button>
              <Button size="sm" variant="danger" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit examination" : "New examination"}>
        {edit && (
          <div className="space-y-3">
            <Field label="Exam name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. MBA Semester II" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type"><select value={edit.exam_type} onChange={(e) => setEdit({ ...edit, exam_type: e.target.value })}><option value="mba">MBA</option><option value="ssc">SSC</option><option value="other">Other</option></select></Field>
              <Field label="Exam date"><input type="date" value={edit.exam_date} onChange={(e) => setEdit({ ...edit, exam_date: e.target.value })} /></Field>
              <Field label="Target %"><input type="number" min={1} max={100} value={edit.target_pct} onChange={(e) => setEdit({ ...edit, target_pct: e.target.value })} /></Field>
              <Field label="Study hours / day" hint="Be realistic — the planner caps unrealistic hours"><input type="number" min={0.5} max={16} step={0.5} value={edit.daily_hours} onChange={(e) => setEdit({ ...edit, daily_hours: e.target.value })} /></Field>
            </div>
            <Field label="Study days">
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" onClick={() => setEdit({ ...edit, study_days: edit.study_days.includes(i) ? edit.study_days.filter((x: number) => x !== i) : [...edit.study_days, i].sort() })}
                    className={`rounded-lg border px-2.5 py-1 text-xs ${edit.study_days.includes(i) ? "border-transparent bg-[#1c1c1f] text-white" : "hairline"}`}>{d}</button>
                ))}
              </div>
            </Field>
            <Field label="Notes"><textarea rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <ErrorNote error={err} />
            <div className="flex justify-end gap-2"><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save} disabled={!edit.name.trim()}>Save</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}
