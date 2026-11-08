"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, ErrorNote, Modal, PageHeader, Spinner, Tabs } from "@/components/ui";
import { api } from "@/lib/api";

const TONE: Record<string, any> = { running: "accent", queued: "neutral", completed: "neutral", failed: "danger", cancelled: "warn", awaiting_approval: "warn", rejected: "danger" };

export default function Agents() {
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<"all" | "running" | "awaiting_approval" | "failed">("all");
  const [open, setOpen] = useState<any | null>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.get(`/api/agents/tasks${filter === "all" ? "" : `?status=${filter}`}`).then(setTasks).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [filter]);
  useEffect(() => { api.get("/api/agents/tools").then(setTools); }, []);

  const roots = (tasks ?? []).filter((t) => !t.parent_id || !(tasks ?? []).some((p) => p.id === t.parent_id));
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : "—");

  return (
    <>
      <PageHeader title="Agent Activity" subtitle="What each agent is doing, which tools it used and how long it took. Only concise task summaries are shown — never hidden reasoning." />
      <ErrorNote error={err} />
      <div className="mb-3"><Tabs value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "running", label: "Running" }, { value: "awaiting_approval", label: "Approvals" }, { value: "failed", label: "Errors" }]} /></div>
      {!tasks ? <Spinner /> : !roots.length ? <Empty title="No agent activity yet" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="muted text-left text-xs"><tr className="border-b hairline"><th className="p-3">Agent</th><th>Task</th><th>Status</th><th>Started</th><th>Completed</th><th>Duration</th><th>Model</th><th>Tools</th><th /></tr></thead>
            <tbody>
              {roots.map((t) => {
                const kids = (tasks ?? []).filter((c) => c.parent_id === t.id);
                return [t, ...kids].map((x, i) => (
                  <tr key={x.id} className={`border-b hairline ${i ? "subtle" : ""}`}>
                    <td className="p-3 font-medium">{i ? "↳ " : ""}{x.agent_name}</td>
                    <td className="max-w-xs truncate">{x.summary}{x.error && <div className="truncate text-xs text-red-600">{x.error}</div>}</td>
                    <td><Badge tone={TONE[x.status]}>{x.status.replace("_", " ")}</Badge></td>
                    <td className="muted text-xs">{fmt(x.started_at)}</td><td className="muted text-xs">{fmt(x.finished_at)}</td>
                    <td className="muted text-xs">{x.duration_ms != null ? `${(x.duration_ms / 1000).toFixed(1)} s` : "—"}</td>
                    <td className="muted text-xs">{x.model}</td><td className="muted text-xs">{x.tool_calls.length}</td>
                    <td className="pr-3 text-right"><div className="flex justify-end gap-1">
                      {x.status === "awaiting_approval" && <><Button size="sm" variant="primary" onClick={async () => { await api.post(`/api/agents/tasks/${x.id}/approve`); load(); }}>Approve</Button><Button size="sm" variant="danger" onClick={async () => { await api.post(`/api/agents/tasks/${x.id}/reject`); load(); }}>Reject</Button></>}
                      {x.status === "running" && <Button size="sm" onClick={async () => { await api.post(`/api/agents/tasks/${x.id}/cancel`); load(); }}>Cancel</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setOpen(x)}>Details</Button></div></td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
      <Card title="Controlled tool registry" className="mt-4">
        <p className="muted mb-3 text-xs">Agents can only use these tools. There is no shell, PowerShell or file-system tool; destructive tools require your approval.</p>
        <ul className="grid gap-2 sm:grid-cols-2">{tools.map((t) => <li key={t.name} className="rounded-lg border hairline p-2.5 text-xs"><div className="flex items-center justify-between"><code>{t.name}</code><Badge tone={t.permission === "destructive" ? "danger" : t.permission === "write" ? "warn" : "neutral"}>{t.permission}</Badge></div><div className="muted mt-1">{t.purpose} · limit {t.timeout_s}s · {t.agents.join(", ")}</div></li>)}</ul>
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.summary ?? ""} wide>
        {open && (
          <div className="space-y-4 text-sm">
            <div><div className="text-xs font-semibold">Progress</div><ul className="mt-1 space-y-1">{open.steps.map((s: any, i: number) => <li key={i}><span className="muted text-xs">{new Date(s.at + "Z").toLocaleTimeString()}</span> {s.message}</li>)}{!open.steps.length && <li className="muted">—</li>}</ul></div>
            <div><div className="text-xs font-semibold">Tool calls</div><ul className="mt-1 space-y-1 font-mono text-xs">{open.tool_calls.map((c: any, i: number) => <li key={i} className={c.ok ? "" : "text-red-600"}>{c.ok ? "✓" : "✗"} {c.tool}({Object.entries(c.args).map(([k, v]) => `${k}=${v}`).join(", ")}) · {c.ms} ms {c.error && `· ${c.error}`}</li>)}{!open.tool_calls.length && <li className="muted">—</li>}</ul></div>
            {open.approval?.action && <div><div className="text-xs font-semibold">Approval</div><pre className="subtle mt-1 overflow-x-auto rounded p-2 text-xs">{JSON.stringify(open.approval, null, 2)}</pre></div>}
            {open.error && <div className="text-red-600">{open.error}</div>}
          </div>
        )}
      </Modal>
    </>
  );
}
