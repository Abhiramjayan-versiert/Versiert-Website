"use client";
import { useEffect, useState } from "react";
import { BarList, LineChart, MinutesBars } from "@/components/Charts";
import { Badge, Card, Empty, ErrorNote, PageHeader, Progress, Spinner, Stat } from "@/components/ui";
import { api, fmtDate, fmtPct } from "@/lib/api";
import { useApp } from "@/lib/app-context";

export default function Analytics() {
  const { pid, profile } = useApp();
  const [a, setA] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (pid) api.get(`/api/profiles/${pid}/analytics`).then(setA).catch((e) => setErr(e.message)); }, [pid]);
  if (err) return <ErrorNote error={err} />;
  if (!a) return <Spinner />;
  const target = a.target_pct;
  return (
    <>
      <PageHeader title="Performance Analytics" subtitle={`${profile?.name} · Readiness against your ${target}% target, computed only from your recorded results.`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`${target}% target engine`} className="lg:col-span-2">
          <div className="flex flex-wrap gap-8">
            <Stat label="Estimated exam score" value={a.estimate_pct == null ? "—" : fmtPct(a.estimate_pct)} hint={a.estimate_pct == null ? "Not enough data — take a timed mock" : `Confidence: ${a.confidence}`} />
            <Stat label="Improvement required" value={a.gap_pct == null ? "—" : a.gap_pct > 0 ? `+${a.gap_pct} pts` : "None"} />
            <Stat label="Total study time" value={`${a.total_study_hours} h`} />
            <Stat label="Streak" value={`${a.streak_days} d`} />
          </div>
          {a.basis?.length > 0 && <p className="muted mt-2 text-xs">Based on: {a.basis.join("; ")}</p>}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Object.entries(a.indicators).map(([k, v]: any) => (
              <div key={k} className="rounded-lg border hairline p-3">
                <div className="flex justify-between text-sm"><span>{v.label}</span><strong>{v.value == null ? "no data" : fmtPct(v.value)}</strong></div>
                <Progress className="mt-2" value={v.value} target={["mock_performance", "practice_accuracy"].includes(k) ? target : undefined} />
                <div className="muted mt-1 text-[11px]">
                  {k === "syllabus_completion" && (v.detail.topics ? `${v.detail.completed}/${v.detail.topics} topics completed, weighted by ${v.detail.weighted_by}` : v.detail.note)}
                  {k === "practice_accuracy" && (v.detail.attempts ? `${v.detail.attempts} attempts in the last 45 days` : v.detail.note)}
                  {k === "retention" && (v.detail.reviews ? `${v.detail.reviews} reviews in 30 days` : "No revision reviews yet")}
                  {k === "mock_performance" && (v.detail.count ? `${v.detail.count} timed mocks · latest ${fmtPct(v.detail.latest)}${v.detail.trend != null ? ` · trend ${v.detail.trend > 0 ? "+" : ""}${v.detail.trend}` : ""}` : v.detail.note)}
                </div>
              </div>
            ))}
          </div>
          <p className="muted mt-4 text-[11px]">{a.disclaimer}</p>
        </Card>
        <Card title="What to do next">
          {a.alerts?.map((x: string, i: number) => <p key={i} className="mb-2 text-sm text-amber-700 dark:text-amber-300">⚠ {x}</p>)}
          <ul className="list-disc space-y-1.5 pl-5 text-sm">{a.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
        </Card>

        <Card title="Timed mock scores over time" className="lg:col-span-2">
          <LineChart points={a.mock_history.map((m: any) => ({ label: fmtDate(m.date, { day: "numeric", month: "short" }), value: m.percentage }))} target={target} />
        </Card>
        <Card title="Subject-wise marks">
          <BarList items={a.subjects.map((s: any) => ({ label: s.subject, value: s.pct }))} target={target} />
          {a.subjects_below_target.length > 0 && <p className="muted mt-3 text-xs">Below target: {a.subjects_below_target.map((s: any) => s.subject).join(", ")}</p>}
        </Card>

        <Card title="Topics losing the most marks" className="lg:col-span-2">
          {a.topics_losing_marks.length ? <BarList items={a.topics_losing_marks.map((t: any) => ({ label: t.topic, value: t.accuracy, sub: `−${t.marks_lost} marks · ${t.attempts} attempts` }))} target={target} /> : <Empty title="No topic data yet" />}
        </Card>
        <Card title="Strong and weak topics">
          <div className="text-xs font-semibold">Strong</div>
          <div className="mb-3 mt-1 flex flex-wrap gap-1">{a.strong_topics.length ? a.strong_topics.map((t: any) => <Badge key={t.topic_id} tone="accent">{t.topic} {t.accuracy}%</Badge>) : <span className="muted text-xs">—</span>}</div>
          <div className="text-xs font-semibold">Weak</div>
          <div className="mt-1 flex flex-wrap gap-1">{a.weak_topics.length ? a.weak_topics.map((t: any) => <Badge key={t.topic_id} tone="warn">{t.topic} {t.accuracy}%</Badge>) : <span className="muted text-xs">—</span>}</div>
        </Card>

        <Card title="Study time (last 30 days)" className="lg:col-span-2"><MinutesBars data={a.study_minutes_by_day} /></Card>
        <Card title="Time management">
          {Object.keys(a.time_management.sec_per_mark_by_type).length ? (
            <ul className="space-y-1 text-sm">{Object.entries(a.time_management.sec_per_mark_by_type).map(([k, v]: any) => <li key={k} className="flex justify-between"><span>{k.replace("_", " ")}</span><span className="muted">{Math.round(v)} s / mark</span></li>)}</ul>
          ) : <p className="muted text-sm">Recorded from timed mocks.</p>}
          {a.time_management.issues.map((x: string, i: number) => <p key={i} className="mt-2 text-xs text-amber-700 dark:text-amber-300">{x}</p>)}
        </Card>

        <Card title="Repeated mistakes" className="lg:col-span-3">
          {a.repeated_mistakes.length ? <ul className="space-y-1 text-sm">{a.repeated_mistakes.map((m: any) => <li key={m.question_id}>{m.text} <span className="muted">— wrong {m.times}×</span></li>)}</ul> : <p className="muted text-sm">No question answered wrongly more than once.</p>}
        </Card>
      </div>
    </>
  );
}
