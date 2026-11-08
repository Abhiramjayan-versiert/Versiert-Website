"use client";
import { Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TaskStatus, useTask } from "@/components/TaskStatus";
import { Badge, Button, Card, Empty, ErrorNote, Field, PageHeader, Spinner } from "@/components/ui";
import { api, fmtDate, fmtPct } from "@/lib/api";
import { useApp } from "@/lib/app-context";

export default function Mocks() {
  const { pid, profile } = useApp();
  const router = useRouter();
  const [list, setList] = useState<any[] | null>(null);
  const [tree, setTree] = useState<any[]>([]);
  const [f, setF] = useState({ title: "", total_marks: 50, duration_min: 90, pattern: "mixed", subject_id: "", difficulty: "medium", mode: "exam", reuse_bank: true });
  const [taskId, setTaskId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.get(`/api/profiles/${pid}/mocks`).then(setList).catch((e) => setErr(e.message));
  useEffect(() => { if (pid) { load(); api.get(`/api/profiles/${pid}/syllabus`).then(setTree); } }, [pid]);
  useEffect(() => { if (profile) setF((x) => ({ ...x, pattern: profile.exam_type === "ssc" ? "ssc" : profile.exam_type === "mba" ? "mba" : "mixed" })); }, [profile]);
  const task = useTask(taskId, (t) => { setTaskId(null); load(); if (t.result_ref?.mock_id) router.push(`/mocks/take/?id=${t.result_ref.mock_id}`); });

  const build = async () => {
    setErr(null);
    try {
      const r = await api.post(`/api/profiles/${pid}/mocks/build`, { ...f, title: f.title || null, total_marks: Number(f.total_marks), duration_min: Number(f.duration_min), subject_id: f.subject_id ? Number(f.subject_id) : null });
      setTaskId(r.task_id);
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <>
      <PageHeader title="Mock Exams" subtitle="Timed exam simulations. In exam mode the answer key stays hidden until you submit." />
      <ErrorNote error={err} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {!list ? <Spinner /> : !list.length ? <Empty title="No mock exams yet">Build your first paper on the right.</Empty> : (
            <ul className="space-y-2">
              {list.map((m) => (
                <li key={m.id} className="card flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.title}</div>
                    <div className="muted text-xs">{m.questions} questions · {m.total_marks} marks · {m.duration_min} min · {fmtDate(m.created_at)}</div>
                  </div>
                  <Badge tone={m.mode === "practice" ? "neutral" : "dark"}>{m.mode}</Badge>
                  {m.status === "evaluated" ? <span className={`text-sm font-semibold ${m.percentage >= (profile?.target_pct ?? 75) ? "text-[var(--color-accent-strong)]" : ""}`}>{fmtPct(m.percentage)}</span> : <Badge tone={m.status === "in_progress" ? "warn" : "neutral"}>{m.status.replace("_", " ")}</Badge>}
                  <Link href={`/mocks/take/?id=${m.id}`}><Button size="sm" variant={m.status === "ready" || m.status === "in_progress" ? "primary" : "secondary"}>{m.status === "ready" ? "Start" : m.status === "in_progress" ? "Resume" : "Open"}</Button></Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card title={<span className="flex items-center gap-2"><Timer className="h-4 w-4" /> Build a mock paper</span>}>
          <div className="space-y-3">
            <Field label="Title (optional)"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Total marks"><input type="number" min={5} max={300} value={f.total_marks} onChange={(e) => setF({ ...f, total_marks: Number(e.target.value) })} /></Field>
              <Field label="Duration (min)"><input type="number" min={5} max={360} value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Exam format"><select value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })}>
              <option value="mba">MBA (short + long + case study)</option><option value="ssc">SSC (objective + assertion-reason)</option><option value="mixed">Mixed</option>
              <option value="objective">Objective only (MCQ)</option><option value="descriptive">Descriptive only</option><option value="numerical">Numerical focus</option></select></Field>
            <Field label="Subject"><select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">All subjects</option>{tree.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Difficulty"><select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}><option>easy</option><option>medium</option><option>hard</option></select></Field>
              <Field label="Mode"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="exam">Timed exam</option><option value="practice">Practice (answers visible)</option></select></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.reuse_bank} onChange={(e) => setF({ ...f, reuse_bank: e.target.checked })} /> Use unseen questions from my bank first</label>
            {taskId ? <TaskStatus task={task} /> : <Button variant="primary" className="w-full" onClick={build}>Build paper</Button>}
            <p className="muted text-[11px]">Generating a full paper with the local model can take several minutes. You can keep using the app meanwhile.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
