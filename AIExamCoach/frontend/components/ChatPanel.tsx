"use client";
import { FileText, Paperclip, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { TaskStatus, useTask } from "./TaskStatus";
import { Badge, Button, ErrorNote } from "./ui";
import { api, qs } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type Msg = { id: number; role: string; content: string; agent: string; citations: any[]; actions: { label: string; href: string }[]; task_id: number | null };
const AGENT_LABEL: Record<string, string> = { orchestrator: "Orchestrator", tutor: "AI Tutor", planner: "Study Planner", syllabus: "Syllabus Analyst",
  questions: "Question Generator", evaluator: "Answer Evaluator", revision: "Revision Coach", analyst: "Performance Analyst" };

export default function ChatPanel({ kind, initial, levelSelector }: { kind: "coach" | "tutor"; initial?: string; levelSelector?: boolean }) {
  const { pid, profile } = useApp();
  const [threads, setThreads] = useState<any[]>([]);
  const [tid, setTid] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [attach, setAttach] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  const loadThreads = useCallback(async () => {
    if (!pid) return [];
    const t = await api.get(`/api/chat/threads${qs({ profile_id: pid, kind })}`);
    setThreads(t);
    return t;
  }, [pid, kind]);

  const loadMsgs = useCallback(async (id: number) => {
    const r = await api.get(`/api/chat/threads/${id}/messages`);
    setMsgs(r.messages);
  }, []);

  useEffect(() => {
    if (!pid) return;
    api.get(`/api/profiles/${pid}/syllabus`).then(setSubjects).catch(() => {});
    loadThreads().then((t) => { if (t.length && !initial) { setTid(t[0].id); } });
  }, [pid, loadThreads, initial]);

  useEffect(() => { if (tid) loadMsgs(tid); }, [tid, loadMsgs]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, taskId]);

  const task = useTask(taskId, () => { if (tid) loadMsgs(tid); setTaskId(null); loadThreads(); });

  const newThread = async () => {
    const t = await api.post("/api/chat/threads", { profile_id: pid, kind });
    setTid(t.id);
    setMsgs([]);
    await loadThreads();
    return t.id as number;
  };

  const send = async (content?: string) => {
    const body = (content ?? text).trim();
    if (!body || !pid) return;
    setErr(null);
    try {
      const id = tid ?? (await newThread());
      setText("");
      setMsgs((m) => [...m, { id: Date.now(), role: "user", content: body, agent: "", citations: [], actions: [], task_id: null }]);
      const r = await api.post(`/api/chat/threads/${id}/messages`, { content: body, subject_id: subjectId ? Number(subjectId) : null, document_id: attach?.id ?? null, level: level || null });
      setAttach(null);
      setTaskId(r.task_id);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    if (initial && pid && !sentInitial.current) {
      sentInitial.current = true;
      newThread().then(() => send(initial));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, pid]);

  const upload = async (f: File) => {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("category", /syllabus/i.test(f.name) ? "syllabus" : "notes");
      if (subjectId) fd.append("subject_id", subjectId);
      const d = await api.upload(`/api/profiles/${pid}/documents`, fd);
      setAttach(d);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  const busy = !!taskId;
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:block">
        <Button className="mb-2 w-full" onClick={newThread}><Plus className="h-4 w-4" /> New conversation</Button>
        <ul className="space-y-0.5">
          {threads.map((t) => (
            <li key={t.id} className={`group flex items-center rounded-lg text-sm ${t.id === tid ? "bg-[var(--subtle)] font-medium" : "hover:bg-[var(--subtle)]"}`}>
              <button className="flex-1 truncate px-2.5 py-2 text-left" onClick={() => setTid(t.id)}>{t.title}</button>
              <button aria-label="Delete conversation" className="hidden p-1.5 group-hover:block" onClick={async () => { if (confirm("Delete this conversation?")) { await api.del(`/api/chat/threads/${t.id}`); if (t.id === tid) { setTid(null); setMsgs([]); } loadThreads(); } }}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="card flex min-h-[70dvh] flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b hairline px-4 py-2.5 text-xs">
          <Badge tone="dark">{profile?.name ?? "No profile"}</Badge>
          <select aria-label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="!w-auto !py-1 !text-xs">
            <option value="">All subjects</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {levelSelector && (
            <select aria-label="Explanation level" value={level} onChange={(e) => setLevel(e.target.value)} className="!w-auto !py-1 !text-xs">
              <option value="">Auto level</option>
              <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
              <option value="mba">MBA examination level</option><option value="ssc">SSC examination level</option>
              <option value="short">Short-answer format</option><option value="long">Long-answer format</option>
            </select>
          )}
          <button className="ml-auto lg:hidden" onClick={newThread}><Plus className="inline h-4 w-4" /> New</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!msgs.length && !busy && (
            <div className="muted mx-auto max-w-md py-10 text-center text-sm">
              {kind === "tutor" ? "Ask me to teach any topic — e.g. “Teach me financial management from the basics”. Follow-up questions keep the lesson context." :
                "Ask anything: study plans, syllabus analysis, mock papers, answer evaluation, revision or whether you are on track for your target."}
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#1c1c1f] px-3.5 py-2 text-sm text-white">{m.content}</div>
              ) : (
                <div className="max-w-full">
                  <div className="mb-1"><Badge tone="accent">{AGENT_LABEL[m.agent] ?? m.agent}</Badge></div>
                  <Markdown text={m.content} />
                  {m.citations?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.citations.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md border hairline px-2 py-0.5 text-[11px]"><FileText className="h-3 w-3" />{c.filename}{c.page ? `, p. ${c.page}` : c.section ? `, ${c.section}` : ""}</span>
                      ))}
                    </div>
                  )}
                  {m.actions?.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{m.actions.map((a, i) => <Link key={i} href={a.href}><Button size="sm">{a.label}</Button></Link>)}</div>}
                </div>
              )}
            </div>
          ))}
          {busy && <TaskStatus task={task} />}
          <div ref={endRef} />
        </div>

        <div className="border-t hairline p-3">
          <ErrorNote error={err} />
          {attach && <div className="mb-2 text-xs">Attached: <strong>{attach.display_name}</strong> <span className="muted">({attach.status})</span> <button className="underline" onClick={() => setAttach(null)}>remove</button></div>}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.jpg,.jpeg,.png" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button type="button" variant="ghost" aria-label="Attach file" loading={uploading} onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
            <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "tutor" ? "Teach me… / ask a follow-up" : "Message your exam coach"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} className="max-h-40 min-h-[42px] resize-y" disabled={busy} />
            <Button type="submit" variant="primary" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
          <p className="muted mt-1.5 text-[10px]">Answers are generated by the local model running on your PC through Ollama. Check important facts against your textbooks.</p>
        </div>
      </div>
    </div>
  );
}
