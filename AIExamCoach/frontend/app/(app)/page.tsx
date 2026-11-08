"use client";
import { AlertTriangle, ArrowRight, Flame } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Progress, Spinner, Stat } from "@/components/ui";
import { api, fmtDate, fmtPct } from "@/lib/api";
import { useApp } from "@/lib/app-context";

export default function Dashboard() {
  const { pid, profile } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState("");

  const load = () => api.get("/api/dashboard").then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [pid]);

  const toggle = async (id: number, done: boolean) => {
    await api.patch(`/api/profiles/${pid}/plans/sessions/${id}`, { status: done ? "done" : "pending" });
    load();
  };

  if (err) return <ErrorNote error={err} />;
  if (!d) return <Spinner />;
  const r = d.readiness;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader title={`${greet}, ${d.user}`} subtitle={profile ? <>Active exam: <strong>{profile.name}</strong>{profile.exam_date && <> · {fmtDate(profile.exam_date)} ({profile.days_left} days)</>}</> : "Create an exam profile to begin."}
        action={<Link href="/coach/"><Button variant="primary">Ask the coach <ArrowRight className="h-4 w-4" /></Button></Link>} />

      {r?.alerts?.length > 0 && (
        <div className="mb-4 space-y-2">
          {r.alerts.map((a: string, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{a}</div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`${profile?.target_pct ?? 75}% target tracker`} className="lg:col-span-2" action={<Link href="/analytics/" className="muted text-xs hover:underline">Details</Link>}>
          {r ? (
            <>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <Stat label="Estimated score" value={r.estimate_pct == null ? "—" : fmtPct(r.estimate_pct)} hint={r.estimate_pct == null ? "Take a timed mock for an estimate" : `Confidence: ${r.confidence}`} />
                <Stat label="Gap to target" value={r.gap_pct == null ? "—" : r.gap_pct > 0 ? `${r.gap_pct} pts` : "On target"} />
                <Stat label="Study streak" value={<span className="inline-flex items-center gap-1"><Flame className="h-5 w-5 text-[var(--color-accent-strong)]" />{d.streak_days}</span>} hint="days" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {Object.entries(r.indicators).map(([k, v]: any) => (
                  <div key={k}>
                    <div className="mb-1 flex justify-between text-xs"><span>{v.label}</span><span className="muted">{v.value == null ? "no data" : fmtPct(v.value)}</span></div>
                    <Progress value={v.value} target={k === "mock_performance" || k === "practice_accuracy" ? r.target_pct : undefined} />
                  </div>
                ))}
              </div>
              <p className="muted mt-4 text-[11px]">{r.disclaimer}</p>
            </>
          ) : <Empty title="No exam profile selected" />}
        </Card>

        <Card title="Today's study targets" action={<Link href="/planner/" className="muted text-xs hover:underline">Planner</Link>}>
          {d.today?.length ? (
            <ul className="space-y-2">
              {d.today.map((s: any) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={s.status === "done"} onChange={(e) => toggle(s.id, e.target.checked)} aria-label={`Mark ${s.title} done`} />
                  <div className={s.status === "done" ? "muted line-through" : ""}>{s.title}<div className="muted text-xs">{s.minutes} min · {s.kind}</div></div>
                </li>
              ))}
            </ul>
          ) : <Empty title="Nothing scheduled today">Create a study plan to get daily targets.</Empty>}
          {d.backlog > 0 && <p className="mt-3 text-xs text-amber-700">{d.backlog} missed session(s) — <Link href="/planner/" className="underline">reschedule</Link></p>}
        </Card>

        <Card title="Active examinations" className="lg:col-span-2" action={<Link href="/exams/" className="muted text-xs hover:underline">Manage</Link>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {d.profiles.map((p: any) => (
              <div key={p.id} className={`rounded-xl border p-3 ${p.id === d.active_profile_id ? "border-[var(--color-accent-strong)]" : "hairline"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{p.name}</div>
                  <Badge tone={p.estimate_pct != null && p.estimate_pct >= p.target_pct ? "accent" : "neutral"}>{p.estimate_pct == null ? "no estimate" : fmtPct(p.estimate_pct)}</Badge>
                </div>
                <div className="muted mt-1 text-xs">{p.exam_date ? `${fmtDate(p.exam_date)} · ${p.days_left} days` : "No exam date"} · target {p.target_pct}%</div>
                <Progress className="mt-2" value={p.syllabus_pct} />
                <div className="muted mt-1 text-[11px]">Syllabus {p.syllabus_pct == null ? "not set up" : fmtPct(p.syllabus_pct)}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Upcoming examinations">
          {d.upcoming_exams.length ? (
            <ul className="space-y-2 text-sm">
              {d.upcoming_exams.map((u: any) => (
                <li key={u.profile_id} className="flex justify-between gap-2"><span className="truncate">{u.name}</span><span className="muted shrink-0">{u.days_left}d</span></li>
              ))}
            </ul>
          ) : <Empty title="No exam dates set" />}
        </Card>

        <Card title="Pending revisions" action={<Link href="/revision/" className="muted text-xs hover:underline">Revise</Link>}>
          <div className="text-2xl font-semibold">{d.pending_revisions ?? 0}</div>
          <ul className="muted mt-2 space-y-1 text-xs">{(d.revision_preview ?? []).map((t: string, i: number) => <li key={i} className="truncate">• {t}</li>)}</ul>
        </Card>

        <Card title="Weak topics">
          {d.weak_topics?.length ? (
            <ul className="space-y-1.5 text-sm">{d.weak_topics.map((t: any) => <li key={t.topic_id} className="flex justify-between gap-2"><span className="truncate">{t.topic}</span><span className="muted">{t.accuracy}%</span></li>)}</ul>
          ) : <Empty title="No weak topics detected yet">They appear after quizzes and mocks.</Empty>}
        </Card>

        <Card title="Recent mock results" action={<Link href="/mocks/" className="muted text-xs hover:underline">All mocks</Link>}>
          {d.recent_mocks?.length ? (
            <ul className="space-y-1.5 text-sm">{d.recent_mocks.map((m: any) => <li key={m.id} className="flex justify-between gap-2"><Link href={`/mocks/take/?id=${m.id}`} className="truncate hover:underline">{m.title}</Link><span className={m.percentage >= (profile?.target_pct ?? 75) ? "font-medium text-[var(--color-accent-strong)]" : "muted"}>{fmtPct(m.percentage)}</span></li>)}</ul>
          ) : <Empty title="No mock exams yet" />}
        </Card>

        <Card title="AI coach" className="lg:col-span-3">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) window.location.href = `/coach/?q=${encodeURIComponent(ask)}`; }}>
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Create a 20-day study plan for my MBA examination" />
            <Button variant="primary" type="submit">Ask</Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {["Tell me whether I am ready to achieve 75%", "Revise the topics I got wrong yesterday", "Generate a 50-mark mock examination", "Analyse my syllabus and identify high-priority topics"].map((s) => (
              <Link key={s} href={`/coach/?q=${encodeURIComponent(s)}`}><Badge>{s}</Badge></Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
