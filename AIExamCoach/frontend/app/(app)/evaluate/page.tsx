"use client";
import { Camera, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskStatus, useTask } from "@/components/TaskStatus";
import { Badge, Button, Card, ErrorNote, Field, PageHeader, Progress } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { useApp } from "@/lib/app-context";

function Result({ e }: { e: any }) {
  const r = e.result;
  const L = ({ t, xs }: { t: string; xs?: string[] }) => <div><div className="text-xs font-semibold">{t}</div>{xs?.length ? <ul className="list-disc pl-5 text-sm">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted text-sm">—</p>}</div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        <div><div className="muted text-xs">Marks awarded</div><div className="text-3xl font-semibold">{r.marks_awarded} <span className="muted text-lg">/ {r.max_marks}</span></div></div>
        <div><div className="muted text-xs">Percentage</div><div className="text-3xl font-semibold">{r.percentage}%</div></div>
        {r.used_marking_scheme && <Badge tone="accent">marked against your uploaded marking scheme</Badge>}
      </div>
      {r.criteria && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries(r.criteria).map(([k, v]: any) => <div key={k}><div className="mb-1 flex justify-between text-xs capitalize"><span>{k}</span><span className="muted">{v}/10</span></div><Progress value={v * 10} /></div>)}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <L t="What was correct" xs={r.what_was_correct} /><L t="What was missing" xs={r.what_was_missing} />
        <L t="What was incorrect" xs={r.what_was_incorrect} /><L t="Important keywords missing" xs={r.missing_keywords} />
      </div>
      <L t="How to improve" xs={r.how_to_improve} />
      {r.guard_notes?.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><div className="text-xs font-semibold">Marking notes</div><ul className="list-disc pl-5">{r.guard_notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></div>}
      {r.python_verification && <div className="rounded-lg border hairline p-3 text-sm"><div className="text-xs font-semibold">Python calculation check</div>Expected: <strong>{r.python_verification.expected ?? "—"}</strong> ({r.python_verification.expected_source}) · Your final answer: <strong>{r.python_verification.student_final ?? "not found"}</strong> · {r.python_verification.match ? "✓ correct" : "✗ does not match"}
        {r.python_verification.steps?.length > 0 && <ul className="mt-1 text-xs">{r.python_verification.steps.map((s: any, i: number) => <li key={i} className={s.correct ? "" : "text-red-600"}>{s.correct ? "✓" : "✗"} {s.step}{!s.correct && ` (should be ${s.computed})`}</li>)}</ul>}</div>}
      <div><div className="text-xs font-semibold">Model answer</div><p className="whitespace-pre-wrap text-sm">{r.model_answer}</p></div>
      <div><div className="text-xs font-semibold">What the examiner expects</div><p className="muted text-sm">{r.expected_answer_explanation}</p></div>
    </div>
  );
}

export default function Evaluate() {
  const { pid } = useApp();
  const [f, setF] = useState({ question_text: "", max_marks: 10, answer_text: "", qtype: "long_answer", model_answer: "", keywords: "", expression: "", expected_value: "" });
  const [ocr, setOcr] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const loadHistory = () => api.get(`/api/profiles/${pid}/evaluations`).then(setHistory);
  useEffect(() => {
    if (!pid) return;
    loadHistory();
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) api.get(`/api/profiles/${pid}/evaluations/${id}`).then(setResult).catch(() => {});
  }, [pid]);
  const task = useTask(taskId, async (t) => { setTaskId(null); if (t.result_ref?.evaluation_id) setResult(await api.get(`/api/profiles/${pid}/evaluations/${t.result_ref.evaluation_id}`)); loadHistory(); });

  const extract = async (file: File) => {
    setErr(null); setExtracting(true); setOcr(null); setConfirmed(false);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.upload(`/api/profiles/${pid}/evaluations/extract`, fd);
      setOcr(r); setF((x) => ({ ...x, answer_text: r.text }));
    } catch (e: any) { setErr(e.message); } finally { setExtracting(false); }
  };

  const evaluate = async () => {
    setErr(null); setResult(null);
    try {
      const r = await api.post(`/api/profiles/${pid}/evaluations`, {
        question_text: f.question_text, max_marks: Number(f.max_marks), answer_text: f.answer_text, qtype: f.qtype, model_answer: f.model_answer,
        keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean), expression: f.expression || null,
        expected_value: f.expected_value ? Number(f.expected_value) : null, input_kind: ocr?.input_kind ?? "text",
        ocr_confidence: ocr?.ocr_confidence ?? null, ocr_confirmed: confirmed,
      });
      setTaskId(r.task_id);
    } catch (e: any) { setErr(e.message); }
  };
  const needsConfirm = ocr?.low_confidence && !confirmed;

  return (
    <>
      <PageHeader title="Answer Evaluation" subtitle="Strict, rubric-based marking with partial credit. Numerical answers are checked in Python; handwritten answers are read with local OCR." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your answer">
          <div className="space-y-3">
            <Field label="Question"><textarea rows={3} value={f.question_text} onChange={(e) => setF({ ...f, question_text: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Maximum marks"><input type="number" min={0.5} max={100} step={0.5} value={f.max_marks} onChange={(e) => setF({ ...f, max_marks: Number(e.target.value) })} /></Field>
              <Field label="Answer type"><select value={f.qtype} onChange={(e) => setF({ ...f, qtype: e.target.value })}><option value="short_answer">Short answer</option><option value="long_answer">Long answer</option><option value="case_study">Case study</option><option value="essay">Essay</option><option value="numerical">Numerical</option></select></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && extract(e.target.files[0])} />
              <input ref={camRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && extract(e.target.files[0])} />
              <Button size="sm" loading={extracting} onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Upload PDF / DOCX / scan</Button>
              <Button size="sm" onClick={() => camRef.current?.click()}><Camera className="h-3.5 w-3.5" /> Photograph handwriting</Button>
            </div>
            {ocr && (
              <div className={`rounded-lg p-3 text-xs ${ocr.low_confidence ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "subtle"}`}>
                {ocr.ocr_used ? <>OCR confidence: <strong>{ocr.ocr_confidence}%</strong>. </> : null}{ocr.message}
                {ocr.low_confidence && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have checked and corrected the extracted text</label>}
              </div>
            )}
            <Field label={ocr ? "Extracted text — correct any OCR mistakes" : "Answer"}><textarea rows={12} value={f.answer_text} onChange={(e) => setF({ ...f, answer_text: e.target.value })} /></Field>
            <details className="text-sm"><summary className="cursor-pointer text-xs font-medium">Optional: marking scheme details</summary>
              <div className="mt-2 space-y-2">
                <Field label="Reference / model answer"><textarea rows={3} value={f.model_answer} onChange={(e) => setF({ ...f, model_answer: e.target.value })} /></Field>
                <Field label="Required keywords (comma separated)"><input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></Field>
                {f.qtype === "numerical" && <div className="grid grid-cols-2 gap-2"><Field label="Correct expression" hint="e.g. 5000*8*3/100"><input value={f.expression} onChange={(e) => setF({ ...f, expression: e.target.value })} /></Field><Field label="or correct value"><input value={f.expected_value} onChange={(e) => setF({ ...f, expected_value: e.target.value })} /></Field></div>}
                <p className="muted text-[11px]">Uploaded marking schemes (Document Library, category “Marking scheme”) are used automatically.</p>
              </div>
            </details>
            <ErrorNote error={err} />
            {taskId ? <TaskStatus task={task} /> : <Button variant="primary" className="w-full" onClick={evaluate} disabled={!f.question_text.trim() || !f.answer_text.trim() || needsConfirm}>{needsConfirm ? "Confirm the OCR text first" : "Evaluate answer"}</Button>}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Evaluation">{result ? <Result e={result} /> : <p className="muted text-sm">Results appear here.</p>}</Card>
          <Card title="Previous evaluations">
            <ul className="divide-y hairline text-sm">{history.slice(0, 15).map((h) => <li key={h.id}><button className="flex w-full justify-between gap-2 py-2 text-left hover:underline" onClick={() => setResult(h)}><span className="truncate">{h.question_text}</span><span className="muted shrink-0">{h.marks_awarded}/{h.max_marks} · {fmtDate(h.created_at, { day: "numeric", month: "short" })}</span></button></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
