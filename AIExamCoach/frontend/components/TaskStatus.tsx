"use client";
import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "./ui";

export type Task = {
  id: number; agent: string; agent_name: string; summary: string; status: string; steps: { at: string; message: string }[];
  error: string; duration_ms: number | null; result_ref: Record<string, any>; children?: Task[]; tool_calls: any[]; model: string;
  started_at: string | null; finished_at: string | null; approval: any;
};

/** Polls an agent task and shows concise progress (never model reasoning). */
export function useTask(taskId: number | null, onDone?: (t: Task) => void) {
  const [task, setTask] = useState<Task | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }
    let stop = false;
    const tick = async () => {
      try {
        const t = await api.get<Task>(`/api/agents/tasks/${taskId}`);
        if (stop) return;
        setTask(t);
        if (!["running", "queued"].includes(t.status)) {
          done.current?.(t);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!stop) setTimeout(tick, 1200);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [taskId]);
  return task;
}

export function TaskStatus({ task, compact }: { task: Task | null; compact?: boolean }) {
  const [cancelling, setCancelling] = useState(false);
  if (!task) return null;
  const running = ["running", "queued"].includes(task.status);
  const active = running ? [task, ...(task.children ?? [])].filter((t) => ["running", "queued"].includes(t.status)).pop() ?? task : task;
  const lastStep = [...(task.children ?? []).flatMap((c) => c.steps), ...task.steps].sort((a, b) => a.at.localeCompare(b.at)).pop();
  const Icon = running ? Loader2 : task.status === "completed" ? CheckCircle2 : task.status === "cancelled" ? CircleSlash : XCircle;
  return (
    <div className={`flex items-start gap-2 rounded-lg border hairline px-3 py-2 text-sm ${compact ? "" : "subtle"}`} aria-live="polite">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${running ? "animate-spin text-[var(--color-accent-strong)]" : task.status === "completed" ? "text-[var(--color-accent-strong)]" : "text-red-500"}`} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {active.agent_name}
          <span className="muted font-normal"> · {running ? lastStep?.message ?? active.summary : task.status === "completed" ? "Done" : task.status}</span>
        </div>
        {task.error && <div className="mt-0.5 text-xs text-red-600">{task.error}</div>}
        {!running && task.duration_ms != null && <div className="muted text-xs">{(task.duration_ms / 1000).toFixed(1)} s · {task.model}</div>}
      </div>
      {running && (
        <Button size="sm" variant="ghost" loading={cancelling} onClick={async () => { setCancelling(true); await api.post(`/api/agents/tasks/${task.id}/cancel`); }}>
          Cancel
        </Button>
      )}
    </div>
  );
}
