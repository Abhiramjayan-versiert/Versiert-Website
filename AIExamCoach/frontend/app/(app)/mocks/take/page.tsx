"use client";
import { Flag, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerView, qLabel } from "@/components/QuestionBits";
import { TaskStatus, useTask } from "@/components/TaskStatus";
import { Badge, Button, Card, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { api, fmtPct } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useQueryParam } from "@/lib/useQuery";

function Clock({ deadline, serverNow, onExpire }: { deadline: string; serverNow: string; onExpire: () => void }) {
  const skew = useRef(new Date(serverNow).getTime() - Date.now());
  const remaining = () => Math.max(0, new Date(deadline).getTime() - (Date.now() + skew.current));
  const [left, setLeft] = useState(remaining);
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const l = remaining();
      setLeft(l);
      if (l === 0 && !fired.current) { fired.current = true; onExpire(); }
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, onExpire]);
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  return <div className={`rounded-lg px-3 py-1.5 font-mono text-lg font-semibold tabular-nums ${left < 5 * 60000 ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300" : "subtle"}`} aria-live="off">{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</div>;
}

function Response({ q, value, onChange, disabled }: { q: any; value: any; onChange: (v: any) => void; disabled: boolean }) {
  if (["mcq", "assertion_reason"].includes(q.qtype) || q.qtype === "true_false") {
    const opts = q.qtype === "true_false" ? ["True", "False"] : q.options;
    return (
      <div className="space-y-2">
        {opts.map((o: string, i: number) => {
          const v = q.qtype === "true_false" ? (i === 0 ? "true" : "false") : i;
          return (
            <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${value === v ? "border-[var(--color-accent-strong)] bg-[var(--color-accent-soft)] dark:bg-lime-950/30" : "hairline"}`}>
              <input type="radio" name={`q${q.id}`} checked={value === v} onChange={() => onChange(v)} disabled={disabled} className="mt-0.5" />
              <span><strong>{String.fromCharCode(65 + i)}.</strong> {o}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (q.qtype === "msq") {
    const cur: number[] = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        <p className="muted text-xs">Select all correct options.</p>
        {q.options.map((o: string, i: number) => (
          <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${cur.includes(i) ? "border-[var(--color-accent-strong)]" : "hairline"}`}>
            <input type="checkbox" checked={cur.includes(i)} disabled={disabled} onChange={(e) => onChange(e.target.checked ? [...cur, i].sort() : cur.filter((x) => x !== i))} className="mt-0.5" />
            <span><strong>{String.fromCharCode(65 + i)}.</strong> {o}</span>
          </label>
        ))}
      </div>
    );
  }
  if (q.qtype === "fill_blank") return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="Your answer" />;
  return <textarea rows={q.qtype === "numerical" ? 6 : q.marks >= 8 ? 16 : 8} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
    placeholder={q.qtype === "numerical" ? "Show your working, then end with: Answer: <value>" : "Write your answer"} />;
}

function Feedback({ fb }: { fb: any }) {
  if (!fb || !Object.keys(fb).length) return null;
  const list = (t: string, xs?: string[]) => xs?.length ? <div><div className="text-xs font-semibold">{t}</div><ul className="list-disc pl-5 text-sm">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null;
  return (
    <div className="mt-3 space-y-2 rounded-lg subtle p-3">
      <div className="text-sm font-semibold">{fb.marks_awarded} / {fb.max_marks} {fb.detail && <span className="muted font-normal">· {fb.detail}</span>}</div>
      {list("What was correct", fb.what_was_correct)}{list("What was missing", fb.what_was_missing)}{list("What was incorrect", fb.what_was_incorrect)}
      {list("Keywords missing", fb.missing_keywords)}{list("How to improve", fb.how_to_improve)}{list("Marking notes", fb.guard_notes)}
      {fb.model_answer && <div><div className="text-xs font-semibold">Model answer</div><p className="whitespace-pre-wrap text-sm">{fb.model_answer}</p></div>}
      {fb.expected_answer_explanation && <p className="muted text-sm">{fb.expected_answer_explanation}</p>}
    </div>
  );
}

export default function TakeMock() {
  const id = useQueryParam("id");
  const { pid, profile } = useApp();
  const [exam, setExam] = useState<any>(null);
  const [cur, setCur] = useState(0);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<number, any>>({});
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<Record<number, any>>({});
  const shownAt = useRef(Date.now());
  const spent = useRef<Record<number, number>>({});

  const load = useCallback(async () => {
    if (!id || !pid) return;
    const e = await api.get(`/api/profiles/${pid}/mocks/${id}`);
    setExam(e);
    setAnswers(Object.fromEntries(e.items.map((it: any) => [it.id, it.response])));
    e.items.forEach((it: any) => (spent.current[it.id] = it.time_spent_sec || 0));
  }, [id, pid]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const task = useTask(taskId, () => { setTaskId(null); load(); });

  const item = exam?.items[cur];
  const editable = exam?.status === "in_progress";

  const save = useCallback(async (itemId: number, response: any, extra: any = {}) => {
    setSaved("saving");
    try {
      await api.put(`/api/profiles/${pid}/mocks/${id}/items/${itemId}`, { response, time_spent_sec: spent.current[itemId], ...extra });
      setSaved("saved");
    } catch (e: any) { setSaved("error"); setErr(e.message); }
  }, [pid, id]);

  const change = (v: any) => {
    if (!item) return;
    setAnswers((a) => ({ ...a, [item.id]: v }));
    clearTimeout(timers.current[item.id]);
    timers.current[item.id] = setTimeout(() => save(item.id, v), 700); // autosave
  };

  const go = (i: number) => {
    if (item) { spent.current[item.id] = (spent.current[item.id] || 0) + Math.round((Date.now() - shownAt.current) / 1000); save(item.id, answers[item.id]); }
    shownAt.current = Date.now();
    setCur(i);
  };

  const submit = useCallback(async (auto = false) => {
    if (!auto && !confirm("Submit the exam? You cannot change answers afterwards.")) return;
    if (item) { spent.current[item.id] = (spent.current[item.id] || 0) + Math.round((Date.now() - shownAt.current) / 1000); await save(item.id, answers[item.id]).catch(() => {}); }
    try { const r = await api.post(`/api/profiles/${pid}/mocks/${id}/submit`); setTaskId(r.task_id); await load(); } catch (e: any) { setErr(e.message); }
  }, [item, answers, save, pid, id, load]);

  if (id === undefined || (!exam && !err)) return <Spinner />;
  if (!exam) return <ErrorNote error={err} />;

  if (exam.status === "ready") return (
    <>
      <PageHeader title={exam.title} subtitle={`${exam.items.length} questions · ${exam.total_marks} marks · ${exam.duration_min} minutes · ${exam.mode === "exam" ? "timed exam mode" : "practice mode"}`} />
      <Card>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>The timer starts when you click Start and keeps running if you leave the page.</li>
          <li>Answers are saved automatically. Use <em>Mark for review</em> to flag questions.</li>
          <li>{exam.mode === "exam" ? "Answers and explanations are revealed only after submission." : "In practice mode you can check each answer as you go."}</li>
          <li>When time runs out the exam is submitted automatically.</li>
        </ul>
        <Button variant="primary" className="mt-4" onClick={async () => setExam(await api.post(`/api/profiles/${pid}/mocks/${id}/start`))}>Start exam</Button>
      </Card>
    </>
  );

  if (["submitted", "evaluating", "evaluated"].includes(exam.status)) {
    const r = exam.result || {};
    return (
      <>
        <PageHeader title={exam.title} subtitle="Results" action={<Link href="/mocks/"><Button>All mocks</Button></Link>} />
        {exam.status !== "evaluated" ? (
          <Card>{taskId ? <TaskStatus task={task} /> : <div className="space-y-2 text-sm"><p>Submitted — not yet evaluated (the local AI may have been offline).</p><Button onClick={async () => setTaskId((await api.post(`/api/profiles/${pid}/mocks/${id}/reevaluate`)).task_id)}><RotateCcw className="h-4 w-4" /> Evaluate now</Button></div>}</Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-end gap-8">
                <div><div className="muted text-xs">Score</div><div className="text-3xl font-semibold">{exam.marks_awarded} / {exam.total_marks}</div></div>
                <div><div className="muted text-xs">Percentage</div><div className={`text-3xl font-semibold ${exam.percentage >= (profile?.target_pct ?? 75) ? "text-[var(--color-accent-strong)]" : ""}`}>{fmtPct(exam.percentage)}</div></div>
                <div><div className="muted text-xs">Target</div><div className="text-3xl font-semibold">{profile?.target_pct ?? 75}%</div></div>
                {r.time_used_min != null && <div><div className="muted text-xs">Time used</div><div className="text-3xl font-semibold">{r.time_used_min} min</div></div>}
              </div>
              <p className="mt-3 text-sm">{r.recommendation}</p>
              {r.by_subject?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{r.by_subject.map((s: any) => <Badge key={s.subject_id ?? 0}>{s.subject}: {s.pct}%</Badge>)}</div>}
              {r.weak_topics?.length > 0 && <p className="mt-2 text-sm">Weak topics: {r.weak_topics.map((w: any) => `${w.topic} (${w.pct}%)`).join(", ")}</p>}
            </Card>
            {exam.items.map((it: any, i: number) => (
              <Card key={it.id} title={<span>Q{i + 1}. <Badge>{qLabel(it.question.qtype)}</Badge> <span className={it.marks_awarded >= it.question.marks ? "text-[var(--color-accent-strong)]" : it.marks_awarded > 0 ? "" : "text-red-600"}>{it.marks_awarded}/{it.question.marks}</span></span>}>
                <p className="whitespace-pre-wrap text-sm">{it.question.text}</p>
                {it.question.options?.length > 0 && <ol className="mt-2 text-sm">{it.question.options.map((o: string, j: number) => <li key={j}>{String.fromCharCode(65 + j)}. {o}</li>)}</ol>}
                <div className="mt-2 text-sm"><span className="muted">Your answer: </span>{it.response == null || it.response === "" ? <em>not attempted</em> : Array.isArray(it.response) ? it.response.map((x: number) => String.fromCharCode(65 + x)).join(", ") : typeof it.response === "number" ? String.fromCharCode(65 + it.response) : <span className="whitespace-pre-wrap">{String(it.response)}</span>}</div>
                <div className="mt-2 rounded-lg border hairline p-3"><AnswerView q={it.question} />{it.question.explanation && <p className="muted mt-1 text-sm">{it.question.explanation}</p>}</div>
                <Feedback fb={it.feedback?.what_was_correct ? it.feedback : null} />
              </Card>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-[52px] z-10 -mx-4 flex items-center justify-between gap-2 border-b hairline bg-[var(--bg)]/95 px-4 py-2 backdrop-blur lg:top-0">
        <div className="min-w-0"><div className="truncate text-sm font-semibold">{exam.title}</div><div className="muted text-xs">{saved === "saving" ? "Saving…" : saved === "error" ? "Not saved" : "All answers saved"}</div></div>
        <div className="flex items-center gap-2">{exam.deadline && exam.mode === "exam" && <Clock deadline={exam.deadline} serverNow={exam.server_now} onExpire={() => submit(true)} />}<Button variant="primary" onClick={() => submit(false)}>Submit</Button></div>
      </div>
      <ErrorNote error={err} />
      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <Card title={<span>Question {cur + 1} of {exam.items.length} · <Badge>{qLabel(item.question.qtype)}</Badge> <Badge>{item.question.marks} marks</Badge></span>}>
          <p className="mb-4 whitespace-pre-wrap text-[15px] leading-relaxed">{item.question.text}</p>
          <Response q={item.question} value={answers[item.id]} onChange={change} disabled={!editable} />
          {exam.mode === "practice" && (
            <div className="mt-3">
              <Button size="sm" onClick={async () => { await save(item.id, answers[item.id]); const r = await api.post(`/api/profiles/${pid}/mocks/${id}/items/${item.id}/check`); setChecks({ ...checks, [item.id]: r }); }}>Check answer</Button>
              {checks[item.id] && <><div className="mt-2 rounded-lg border hairline p-3"><AnswerView q={checks[item.id].question} /></div><Feedback fb={checks[item.id].feedback} /></>}
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <Button onClick={() => go(cur - 1)} disabled={cur === 0}>Previous</Button>
            <Button variant={item.marked_review ? "primary" : "ghost"} onClick={async () => { const v = !item.marked_review; await save(item.id, answers[item.id], { marked_review: v }); setExam({ ...exam, items: exam.items.map((x: any) => (x.id === item.id ? { ...x, marked_review: v } : x)) }); }}><Flag className="h-4 w-4" /> {item.marked_review ? "Marked for review" : "Mark for review"}</Button>
            <Button onClick={() => go(cur + 1)} disabled={cur === exam.items.length - 1}>Next</Button>
          </div>
        </Card>
        <Card title="Questions">
          <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
            {exam.items.map((it: any, i: number) => {
              const a = answers[it.id];
              const done = !(a === null || a === undefined || a === "" || (Array.isArray(a) && !a.length));
              return <button key={it.id} onClick={() => go(i)} aria-label={`Question ${i + 1}`}
                className={`relative h-9 rounded-md text-xs font-medium ${i === cur ? "ring-2 ring-[var(--color-accent-strong)]" : ""} ${done ? "bg-[#1c1c1f] text-white dark:bg-white dark:text-black" : "border hairline"}`}>
                {i + 1}{it.marked_review && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500" />}
              </button>;
            })}
          </div>
          <div className="muted mt-3 space-y-1 text-[11px]"><div>■ answered · □ not answered</div><div><span className="text-amber-500">●</span> marked for review</div></div>
        </Card>
      </div>
    </div>
  );
}
