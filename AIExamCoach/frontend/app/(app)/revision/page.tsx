"use client";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { TaskStatus, useTask } from "@/components/TaskStatus";
import { Badge, Button, Card, Empty, ErrorNote, Field, PageHeader, Spinner, Stat, Tabs } from "@/components/ui";
import { api, fmtDate, fmtPct } from "@/lib/api";
import { useApp } from "@/lib/app-context";

function Flashcards({ pid, items, onGraded }: { pid: number; items: any[]; onGraded: () => void }) {
  const [i, setI] = useState(0);
  const [show, setShow] = useState(false);
  if (!items.length) return <Empty title="Nothing due today">Great — come back tomorrow, or generate new flashcards.</Empty>;
  const it = items[Math.min(i, items.length - 1)];
  const grade = async (g: number) => {
    await api.post(`/api/profiles/${pid}/revision/items/${it.id}/review`, { grade: g });
    setShow(false);
    if (i + 1 >= items.length) onGraded(); else setI(i + 1);
  };
  return (
    <div>
      <div className="muted mb-2 text-xs">Card {i + 1} of {items.length} · <Badge>{it.kind}</Badge> {it.topic && <Badge>{it.topic}</Badge>} {it.lapses > 0 && <Badge tone="warn">forgotten {it.lapses}×</Badge>}</div>
      <button onClick={() => setShow(true)} className="card flex min-h-48 w-full flex-col justify-center p-6 text-left">
        <div className="whitespace-pre-wrap text-base font-medium">{it.front}</div>
        {show ? <div className="mt-4 whitespace-pre-wrap border-t hairline pt-4 text-sm">{it.back}</div> : <div className="muted mt-4 text-xs">Recall the answer, then tap to reveal.</div>}
      </button>
      {show && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Button onClick={() => grade(1)}>Forgot</Button><Button onClick={() => grade(3)}>Hard</Button><Button onClick={() => grade(4)}>Good</Button><Button variant="primary" onClick={() => grade(5)}>Easy</Button>
        </div>
      )}
    </div>
  );
}

function Quiz({ pid }: { pid: number }) {
  const [qs, setQs] = useState<any[] | null>(null);
  const [ans, setAns] = useState<Record<number, any>>({});
  const [res, setRes] = useState<any>(null);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const start = async () => { setRes(null); setAns({}); setQs(await api.get(`/api/profiles/${pid}/revision/quiz?n=10&only_incorrect=${onlyWrong}`)); };
  const submit = async () => setRes(await api.post(`/api/profiles/${pid}/revision/quiz`, { answers: qs!.map((q) => ({ question_id: q.id, response: ans[q.id] ?? null })) }));
  if (!qs) return (
    <div className="space-y-3">
      <p className="muted text-sm">A quick objective quiz prioritising your weak topics and previously incorrect questions. Wrong answers become revision cards.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} /> Only questions I got wrong before</label>
      <Button variant="primary" onClick={start}>Start quick quiz</Button>
    </div>
  );
  if (!qs.length) return <Empty title="No objective questions available">Generate MCQs in the Question Bank first.</Empty>;
  return (
    <div className="space-y-3">
      {res && <div className="rounded-lg subtle p-3 text-sm font-semibold">Score: {res.score}/{res.total} ({res.pct}%)</div>}
      {qs.map((q, n) => {
        const r = res?.results.find((x: any) => x.question.id === q.id);
        return (
          <div key={q.id} className="rounded-lg border hairline p-3">
            <div className="text-sm">{n + 1}. {q.text}</div>
            {q.qtype === "fill_blank" || q.qtype === "numerical" ? <input className="mt-2" value={ans[q.id] ?? ""} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} disabled={!!res} /> : (
              <div className="mt-2 space-y-1">{(q.qtype === "true_false" ? ["True", "False"] : q.options).map((o: string, i: number) => {
                const v = q.qtype === "true_false" ? (i === 0 ? "true" : "false") : i;
                const isMulti = q.qtype === "msq";
                const cur = ans[q.id];
                const checked = isMulti ? (cur ?? []).includes(i) : cur === v;
                return <label key={i} className="flex items-center gap-2 text-sm"><input type={isMulti ? "checkbox" : "radio"} name={`qq${q.id}`} checked={checked} disabled={!!res}
                  onChange={(e) => setAns({ ...ans, [q.id]: isMulti ? (e.target.checked ? [...(cur ?? []), i] : (cur ?? []).filter((x: number) => x !== i)) : v })} />{String.fromCharCode(65 + i)}. {o}</label>;
              })}</div>
            )}
            {r && <div className={`mt-2 text-xs ${r.correct ? "text-[var(--color-accent-strong)]" : "text-red-600"}`}>{r.correct ? "Correct" : r.detail}{r.question.explanation && <span className="muted"> — {r.question.explanation}</span>}</div>}
          </div>
        );
      })}
      {res ? <Button onClick={start}>New quiz</Button> : <Button variant="primary" onClick={submit}>Submit quiz</Button>}
    </div>
  );
}

export default function Revision() {
  const { pid } = useApp();
  const [tab, setTab] = useState<"today" | "quiz" | "all">("today");
  const [due, setDue] = useState<any>(null);
  const [all, setAll] = useState<any[]>([]);
  const [tree, setTree] = useState<any[]>([]);
  const [topicId, setTopicId] = useState("");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [card, setCard] = useState({ front: "", back: "", kind: "flashcard" });
  const [err, setErr] = useState<string | null>(null);

  const load = async () => { if (!pid) return; setDue(await api.get(`/api/profiles/${pid}/revision/due`)); setAll(await api.get(`/api/profiles/${pid}/revision/items`)); };
  useEffect(() => { load().catch((e) => setErr(e.message)); if (pid) api.get(`/api/profiles/${pid}/syllabus`).then(setTree); }, [pid]);
  const task = useTask(taskId, () => { setTaskId(null); load(); });
  const topics = tree.flatMap((s) => s.topics.filter((t: any) => t.kind !== "unit").map((t: any) => ({ ...t, subject: s.name })));

  if (!due) return <Spinner />;
  return (
    <>
      <PageHeader title="Revision Centre" subtitle="Spaced repetition (SM-2) with your mistakes and weak topics first." />
      <ErrorNote error={err} />
      <div className="mb-4 grid grid-cols-3 gap-4">
        <Card><Stat label="Due today" value={due.items.length} /></Card>
        <Card><Stat label="Scheduled later" value={due.upcoming} /></Card>
        <Card><Stat label="Recall rate (30 days)" value={fmtPct(due.stats.recall_rate)} hint={`${due.stats.reviews} reviews`} /></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Tabs value={tab} onChange={setTab} options={[{ value: "today", label: "Today's revision" }, { value: "quiz", label: "Quick quiz" }, { value: "all", label: "All cards" }]} />
          {tab === "today" && pid && <Flashcards pid={pid} items={due.items} onGraded={load} />}
          {tab === "quiz" && pid && <Quiz pid={pid} />}
          {tab === "all" && (
            <ul className="divide-y hairline card px-4">{all.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-2 text-sm"><Badge>{i.kind}</Badge><span className="flex-1 truncate">{i.front}</span><span className="muted text-xs">due {fmtDate(i.due_date, { day: "numeric", month: "short" })}</span>
                <button className="muted text-xs underline" onClick={async () => { await api.del(`/api/profiles/${pid}/revision/items/${i.id}`); load(); }}>delete</button></li>))}
              {!all.length && <li className="muted py-4 text-sm">No cards yet.</li>}
            </ul>
          )}
        </div>
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Generate flashcards</span>}>
            <Field label="Topic"><select value={topicId} onChange={(e) => setTopicId(e.target.value)}><option value="">Choose a topic</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.subject} — {t.name}</option>)}</select></Field>
            <div className="mt-3">{taskId ? <TaskStatus task={task} /> : <Button variant="primary" className="w-full" disabled={!topicId} onClick={async () => setTaskId((await api.post(`/api/profiles/${pid}/revision/generate`, { topic_id: Number(topicId), count: 8 })).task_id)}>Generate definitions, formulas & recall cards</Button>}</div>
          </Card>
          <Card title="Add a card">
            <div className="space-y-2">
              <select value={card.kind} onChange={(e) => setCard({ ...card, kind: e.target.value })}><option value="flashcard">Flashcard</option><option value="definition">Definition</option><option value="formula">Formula</option></select>
              <textarea rows={2} placeholder="Front (question / term)" value={card.front} onChange={(e) => setCard({ ...card, front: e.target.value })} />
              <textarea rows={2} placeholder="Back (answer)" value={card.back} onChange={(e) => setCard({ ...card, back: e.target.value })} />
              <Button className="w-full" disabled={!card.front.trim() || !card.back.trim()} onClick={async () => { await api.post(`/api/profiles/${pid}/revision/items`, card); setCard({ front: "", back: "", kind: card.kind }); load(); }}>Add card</Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
