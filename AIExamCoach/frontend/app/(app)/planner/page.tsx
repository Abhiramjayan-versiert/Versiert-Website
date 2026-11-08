"use client";
import { CalendarClock, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Field, PageHeader, Progress, Spinner, Tabs } from "@/components/ui";
import { api, fmtDate, todayISO } from "@/lib/api";
import { useApp } from "@/lib/app-context";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_TONE: Record<string, any> = { learn: "dark", revise: "accent", practice: "neutral", mock: "warn" };

function weekKey(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

export default function Planner() {
  const { pid, profile } = useApp();
  const [plan, setPlan] = useState<any | null | undefined>(undefined);
  const [view, setView] = useState<"daily" | "weekly" | "monthly">("daily");
  const [form, setForm] = useState<any>({ days: "", daily_hours: "", weekdays: null as number[] | null, include_revision: true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/api/profiles/${pid}/plans/active`).then(setPlan).catch((e) => setErr(e.message));
  useEffect(() => { if (pid) load(); }, [pid]);
  useEffect(() => { if (profile) setForm((f: any) => ({ ...f, daily_hours: f.daily_hours || profile.daily_hours, weekdays: f.weekdays ?? profile.study_days })); }, [profile]);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      setPlan(await api.post(`/api/profiles/${pid}/plans`, { days: form.days ? Number(form.days) : null, daily_hours: Number(form.daily_hours) || null, weekdays: form.weekdays, include_revision: form.include_revision }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const reschedule = async () => { setBusy(true); setErr(null); try { setPlan(await api.post(`/api/profiles/${pid}/plans/reschedule`)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const mark = async (s: any, status: string, topic_completed = false) => { await api.patch(`/api/profiles/${pid}/plans/sessions/${s.id}`, { status, topic_completed }); load(); };

  const grouped = useMemo(() => {
    if (!plan?.sessions) return [];
    const by: Record<string, any[]> = {};
    for (const s of plan.sessions) {
      const k = view === "daily" ? s.day : view === "weekly" ? weekKey(s.day) : s.day.slice(0, 7);
      (by[k] ??= []).push(s);
    }
    return Object.entries(by);
  }, [plan, view]);

  if (plan === undefined) return <Spinner />;
  const today = todayISO();
  return (
    <>
      <PageHeader title="Study Planner" subtitle="Realistic schedules from your syllabus, weightage, weak areas and available time. Missed sessions can be rescheduled automatically."
        action={plan && <Button onClick={reschedule} loading={busy}><RefreshCw className="h-4 w-4" /> Reschedule remaining</Button>} />
      <ErrorNote error={err} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {plan ? (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="font-semibold">{plan.title}</div><div className="muted text-xs">{fmtDate(plan.start_date)} – {fmtDate(plan.end_date)}</div></div>
                  <div className="w-full sm:w-56"><div className="muted mb-1 text-xs">{plan.progress.done}/{plan.progress.total} sessions done · {plan.progress.missed} missed</div><Progress value={plan.progress.pct} /></div>
                </div>
                <p className="muted mt-3 text-sm">{plan.summary}</p>
                {plan.warnings?.map((w: string, i: number) => <p key={i} className="mt-2 text-xs text-amber-700 dark:text-amber-300">{w}</p>)}
              </Card>
              <Tabs value={view} onChange={setView} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />
              {grouped.map(([k, list]) => {
                const mins = list.reduce((a, s) => a + s.minutes, 0);
                return (
                  <Card key={k} title={<span className={k === today ? "text-[var(--color-accent-strong)]" : ""}>{view === "daily" ? fmtDate(k, { weekday: "long", day: "numeric", month: "short" }) : view === "weekly" ? `Week of ${fmtDate(k)}` : fmtDate(k + "-01", { month: "long", year: "numeric" })}{k === today && " · Today"}</span>}
                    action={<span className="muted text-xs">{(mins / 60).toFixed(1)} h</span>}>
                    {view === "monthly" ? (
                      <div className="muted text-sm">{list.filter((s) => s.kind === "learn").length} learning · {list.filter((s) => s.kind === "revise").length} revision · {list.filter((s) => s.kind === "mock").length} mocks · {list.filter((s) => s.status === "done").length} done</div>
                    ) : (
                      <ul className="divide-y hairline">
                        {list.map((s) => (
                          <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                            {view === "weekly" && <span className="muted w-10 text-xs">{DAYS[(new Date(s.day + "T00:00:00").getDay() + 6) % 7]}</span>}
                            <Badge tone={KIND_TONE[s.kind]}>{s.kind}</Badge>
                            <span className={`flex-1 ${s.status === "done" ? "muted line-through" : s.status === "missed" ? "text-red-600" : ""}`}>{s.title}{s.subject && <span className="muted text-xs"> · {s.subject}</span>}</span>
                            <span className="muted text-xs">{s.minutes}m</span>
                            {s.status === "pending" || s.status === "missed" ? (
                              <div className="flex gap-1">
                                <Button size="sm" onClick={() => mark(s, "done")}>Done</Button>
                                {s.kind === "learn" && s.topic_id && <Button size="sm" variant="ghost" onClick={() => mark(s, "done", true)} title="Done and topic fully completed">Topic ✓</Button>}
                              </div>
                            ) : s.status === "done" ? <Button size="sm" variant="ghost" onClick={() => mark(s, "pending")}>Undo</Button> : <Badge>{s.status}</Badge>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })}
            </>
          ) : <Empty title="No active study plan">Create one on the right. You need a syllabus with topics first.</Empty>}
        </div>

        <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> {plan ? "Create a new plan" : "Create a plan"}</span>}>
          <div className="space-y-3">
            <Field label="Number of days" hint={profile?.exam_date ? `Leave empty to plan until the exam (${fmtDate(profile.exam_date)})` : "Set an exam date on the profile, or enter days"}>
              <input type="number" min={1} max={365} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
            </Field>
            <Field label="Study hours per day"><input type="number" min={0.5} max={16} step={0.5} value={form.daily_hours} onChange={(e) => setForm({ ...form, daily_hours: e.target.value })} /></Field>
            <Field label="Study days">
              <div className="flex flex-wrap gap-1">{DAYS.map((d, i) => (
                <button key={d} type="button" onClick={() => setForm({ ...form, weekdays: form.weekdays?.includes(i) ? form.weekdays.filter((x: number) => x !== i) : [...(form.weekdays ?? []), i].sort() })}
                  className={`rounded-md border px-2 py-1 text-xs ${form.weekdays?.includes(i) ? "border-transparent bg-[#1c1c1f] text-white" : "hairline"}`}>{d}</button>))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.include_revision} onChange={(e) => setForm({ ...form, include_revision: e.target.checked })} /> Include spaced revision</label>
            <Button variant="primary" className="w-full" onClick={create} loading={busy}>Generate plan</Button>
            <p className="muted text-[11px]">Creating a new plan replaces the active one. Completed sessions remain in your history.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
