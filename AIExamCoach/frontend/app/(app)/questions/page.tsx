"use client";
import { Plus, Sparkles, Timer, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TaskStatus, useTask } from "@/components/TaskStatus";
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, PageHeader, Spinner } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { AnswerView, QTYPES, qLabel as label } from "@/components/QuestionBits";

export default function Questions() {
  const { pid } = useApp();
  const router = useRouter();
  const [list, setList] = useState<any[] | null>(null);
  const [tree, setTree] = useState<any[]>([]);
  const [filter, setFilter] = useState({ qtype: "", subject_id: "" });
  const [gen, setGen] = useState({ qtype: "mcq", count: 5, difficulty: "medium", subject_id: "", topic_id: "" });
  const [taskId, setTaskId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [open, setOpen] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState<any | null>(null);

  const load = () => api.get(`/api/profiles/${pid}/questions${qs(filter)}`).then(setList).catch((e) => setErr(e.message));
  useEffect(() => { if (pid) { load(); api.get(`/api/profiles/${pid}/syllabus`).then(setTree); } }, [pid, filter]);
  const task = useTask(taskId, () => { setTaskId(null); load(); });
  const topics = tree.find((s) => String(s.id) === gen.subject_id)?.topics.filter((t: any) => t.kind !== "unit") ?? [];

  const generate = async () => {
    setErr(null);
    try {
      const r = await api.post(`/api/profiles/${pid}/questions/generate`, { qtype: gen.qtype, count: Number(gen.count), difficulty: gen.difficulty,
        subject_id: gen.subject_id ? Number(gen.subject_id) : null, topic_ids: gen.topic_id ? [Number(gen.topic_id)] : null });
      setTaskId(r.task_id);
    } catch (e: any) { setErr(e.message); }
  };
  const makeMock = async () => {
    const title = prompt("Title for this mock exam:", "Custom mock exam");
    if (!title) return;
    const mins = Number(prompt("Duration in minutes:", "60") || 60);
    const r = await api.post(`/api/profiles/${pid}/mocks/from-bank`, { title, question_ids: selected, duration_min: mins });
    router.push(`/mocks/take/?id=${r.id}`);
  };
  const saveManual = async () => {
    try {
      const m = manual;
      const body: any = { qtype: m.qtype, text: m.text, marks: Number(m.marks), difficulty: m.difficulty, explanation: m.explanation, subject_id: m.subject_id ? Number(m.subject_id) : null, options: [], answer: {} };
      if (["mcq", "msq"].includes(m.qtype)) { body.options = m.options.split("\n").filter((x: string) => x.trim()); body.answer = { correct: m.correct.split(/[ ,]+/).filter(Boolean).map((x: string) => x.toUpperCase().charCodeAt(0) - 65) }; }
      else if (m.qtype === "true_false") { body.options = ["True", "False"]; body.answer = { correct: m.correct.toLowerCase().startsWith("t") }; }
      else if (m.qtype === "fill_blank") body.answer = { correct: m.correct, accepted: m.correct.split("|").map((x: string) => x.trim()) };
      else if (m.qtype === "numerical") body.answer = /[*/+\-]/.test(m.correct) ? { expression: m.correct, tolerance_pct: 1 } : { value: Number(m.correct), tolerance_pct: 1 };
      else body.answer = { model_answer: m.correct };
      await api.post(`/api/profiles/${pid}/questions`, body);
      setManual(null); load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <>
      <PageHeader title="Question Bank" subtitle="AI-generated and your own questions. Generated questions are for practice — they are not actual or guaranteed exam questions."
        action={<>{selected.length > 0 && <Button variant="primary" onClick={makeMock}><Timer className="h-4 w-4" /> Mock from {selected.length} selected</Button>}
          <Button onClick={() => setManual({ qtype: "mcq", text: "", options: "", correct: "", marks: 1, difficulty: "medium", explanation: "", subject_id: "" })}><Plus className="h-4 w-4" /> Add manually</Button></>} />
      <ErrorNote error={err} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select className="!w-auto" value={filter.qtype} onChange={(e) => setFilter({ ...filter, qtype: e.target.value })} aria-label="Filter type"><option value="">All types</option>{QTYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select className="!w-auto" value={filter.subject_id} onChange={(e) => setFilter({ ...filter, subject_id: e.target.value })} aria-label="Filter subject"><option value="">All subjects</option>{tree.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          {!list ? <Spinner /> : !list.length ? <Empty title="No questions yet">Generate some on the right.</Empty> : (
            <ul className="space-y-2">
              {list.map((q) => (
                <li key={q.id} className="card flex gap-3 p-3">
                  <input type="checkbox" aria-label="Select for mock" checked={selected.includes(q.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, q.id] : selected.filter((x) => x !== q.id))} className="mt-1" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(q)}>
                    <div className="line-clamp-2 text-sm">{q.text}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5"><Badge>{label(q.qtype)}</Badge><Badge>{q.marks} marks</Badge><Badge>{q.difficulty}</Badge>{q.citations?.length > 0 && <Badge tone="accent">sourced</Badge>}{q.source === "manual" && <Badge tone="dark">manual</Badge>}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Generate questions</span>}>
          <div className="space-y-3">
            <Field label="Type"><select value={gen.qtype} onChange={(e) => setGen({ ...gen, qtype: e.target.value })}>{QTYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="How many"><input type="number" min={1} max={30} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} /></Field>
              <Field label="Difficulty"><select value={gen.difficulty} onChange={(e) => setGen({ ...gen, difficulty: e.target.value })}><option>easy</option><option>medium</option><option>hard</option></select></Field>
            </div>
            <Field label="Subject"><select value={gen.subject_id} onChange={(e) => setGen({ ...gen, subject_id: e.target.value, topic_id: "" })}><option value="">Any</option>{tree.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            {topics.length > 0 && <Field label="Topic"><select value={gen.topic_id} onChange={(e) => setGen({ ...gen, topic_id: e.target.value })}><option value="">All topics</option>{topics.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
            {taskId ? <TaskStatus task={task} /> : <Button variant="primary" className="w-full" onClick={generate}>Generate</Button>}
            <p className="muted text-[11px]">Questions are grounded on your uploaded textbooks, past papers and marking schemes when available. Invalid questions are discarded automatically.</p>
          </div>
        </Card>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? label(open.qtype) : ""} wide>
        {open && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap text-sm">{open.text}</p>
            {open.options?.length > 0 && <ol className="space-y-1 text-sm">{open.options.map((o: string, i: number) => <li key={i}>{String.fromCharCode(65 + i)}. {o}</li>)}</ol>}
            <div className="rounded-lg subtle p-3"><AnswerView q={open} />{open.explanation && <p className="muted mt-2 text-sm">{open.explanation}</p>}</div>
            {open.rubric?.length > 0 && <div className="text-sm"><div className="text-xs font-semibold">Rubric</div><ul className="list-disc pl-5">{open.rubric.map((r: any, i: number) => <li key={i}>{r.point} ({r.marks})</li>)}</ul></div>}
            {open.citations?.length > 0 && <div className="muted text-xs">Sources: {open.citations.map((c: any) => `${c.filename}${c.page ? ` p.${c.page}` : ""}`).join("; ")}</div>}
            <div className="flex justify-end"><Button variant="danger" onClick={async () => { try { await api.del(`/api/profiles/${pid}/questions/${open.id}`); setOpen(null); load(); } catch (e: any) { alert(e.message); } }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!manual} onClose={() => setManual(null)} title="Add a question">
        {manual && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Type"><select value={manual.qtype} onChange={(e) => setManual({ ...manual, qtype: e.target.value })}>{QTYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Marks"><input type="number" value={manual.marks} onChange={(e) => setManual({ ...manual, marks: e.target.value })} /></Field>
              <Field label="Subject"><select value={manual.subject_id} onChange={(e) => setManual({ ...manual, subject_id: e.target.value })}><option value="">—</option>{tree.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            </div>
            <Field label="Question"><textarea rows={3} value={manual.text} onChange={(e) => setManual({ ...manual, text: e.target.value })} /></Field>
            {["mcq", "msq"].includes(manual.qtype) && <Field label="Options (one per line)"><textarea rows={4} value={manual.options} onChange={(e) => setManual({ ...manual, options: e.target.value })} /></Field>}
            <Field label="Answer" hint={{ mcq: "Letter, e.g. B", msq: "Letters, e.g. A, C", true_false: "true or false", fill_blank: "Accepted answers separated by |", numerical: "Value, or an arithmetic expression (verified in Python)" }[manual.qtype as string] ?? "Model answer"}>
              <textarea rows={["mcq", "msq", "true_false", "fill_blank", "numerical"].includes(manual.qtype) ? 1 : 5} value={manual.correct} onChange={(e) => setManual({ ...manual, correct: e.target.value })} />
            </Field>
            <Field label="Explanation"><textarea rows={2} value={manual.explanation} onChange={(e) => setManual({ ...manual, explanation: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button onClick={() => setManual(null)}>Cancel</Button><Button variant="primary" onClick={saveManual}>Save</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}
