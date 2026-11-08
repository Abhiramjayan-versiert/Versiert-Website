"use client";
import { Cpu, Download, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorNote, PageHeader, Progress, Spinner, Stat } from "@/components/ui";
import { api } from "@/lib/api";

export default function Models() {
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<any>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const load = () => api.get("/api/models").then(setO).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  const pull = async (model: string) => {
    setErr(null);
    const check = await api.post("/api/models/check", { model });
    if (check.decision === "blocked") return setErr(`Blocked: ${check.reasons.join(" ")}`);
    let approved = false;
    const size = check.estimate?.size_gb ? `~${check.estimate.size_gb} GB download, ~${check.estimate.run_gb} GB memory when running.` : "Size unknown.";
    if (check.decision === "needs_approval") {
      approved = confirm(`${model} needs your approval:\n\n${check.reasons.join("\n")}\n${size}\n\nDownload anyway?`);
      if (!approved) return;
    } else if (!confirm(`Download ${model}? ${size}\n${check.reasons.join(" ")}`)) return;
    const r = await api.post("/api/models/pull", { model, approved });
    if (!r.started) setErr(r.reasons?.join(" ") || "Not started");
    load();
  };
  const runTest = async (kind: "chat" | "embedding") => {
    setTesting(kind); setTest(null); setErr(null);
    try { setTest({ kind, ...(await api.post("/api/models/test", { kind })) }); } catch (e: any) { setErr(e.message); } finally { setTesting(null); load(); }
  };

  if (!o) return <Spinner />;
  const sys = o.system;
  const gpu = sys.gpus?.[0];
  return (
    <>
      <PageHeader title="Model Manager" subtitle="All AI runs through Ollama on this PC (127.0.0.1:11434). No cloud models, no API keys." />
      <ErrorNote error={err} />
      {!o.available && (
        <Card className="mb-4 border-red-300">
          <div className="font-semibold text-red-600">Ollama is not available</div>
          <p className="mt-1 text-sm">{o.error}</p>
          <ul className="muted mt-2 list-disc pl-5 text-sm">{o.recovery?.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
          <p className="muted mt-2 text-xs">No cloud model is used as a substitute.</p>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Hardware">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="GPU" value={<span className="text-base">{gpu ? gpu.name : "None detected"}</span>} hint={gpu ? `Driver ${gpu.driver}` : "Models run on CPU"} />
            <Stat label="VRAM free" value={gpu ? `${(gpu.vram_free_mb / 1024).toFixed(1)} GB` : "—"} hint={gpu ? `of ${(gpu.vram_total_mb / 1024).toFixed(1)} GB` : ""} />
            <Stat label="RAM available" value={`${(sys.ram_available_mb / 1024).toFixed(1)} GB`} hint={`of ${(sys.ram_total_mb / 1024).toFixed(0)} GB`} />
            <Stat label="Disk free" value={`${sys.disk_free_gb} GB`} />
          </div>
          {sys.warnings?.map((w: string, i: number) => <p key={i} className="mt-3 text-xs text-amber-700 dark:text-amber-300">⚠ {w}</p>)}
        </Card>
        <Card title="Loaded now" className="lg:col-span-2">
          {o.loaded?.length ? o.loaded.map((m: any) => (
            <div key={m.name} className="mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium">{m.name}</span><Badge tone={m.processor === "GPU" ? "accent" : m.processor === "CPU" ? "warn" : "neutral"}>{m.processor}</Badge></div>
              <div className="muted mt-1 text-xs">{m.size_gb} GB in memory · {m.vram_gb} GB in VRAM · context {m.context_length} · unloads {m.expires_at ? new Date(m.expires_at).toLocaleTimeString() : "—"}</div>
              <Progress className="mt-2" value={m.gpu_pct} />
            </div>
          )) : <p className="muted text-sm">No model is loaded. It loads automatically on the next request and unloads after {`5`} minutes idle.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => runTest("chat")} loading={testing === "chat"} disabled={!o.available}><Play className="h-3.5 w-3.5" /> Test {o.active_chat_model}</Button>
            <Button onClick={() => runTest("embedding")} loading={testing === "embedding"} disabled={!o.available}><Play className="h-3.5 w-3.5" /> Test {o.active_embedding_model}</Button>
            <Button variant="ghost" onClick={async () => { await api.post("/api/models/unload", {}); load(); }}>Unload now</Button>
          </div>
          {test && <div className="subtle mt-3 rounded-lg p-3 text-sm">{test.kind === "chat" ? <>Reply: “{test.reply}” · {(test.duration_ms / 1000).toFixed(1)} s · {test.tokens_per_sec} tokens/s · {test.placement?.processor ?? "—"}</> : <>{test.dimensions}-dimension embedding in {test.duration_ms} ms</>}</div>}
          <p className="muted mt-3 text-[11px]">Queue: {o.queue.running} running, {o.queue.waiting} waiting (limit {o.queue.limit}). Context: {o.context_length} tokens. Speed depends on whether the model fits in GPU memory — CPU fallback is slower.</p>
        </Card>

        <Card title="Installed models" className="lg:col-span-2">
          {o.missing_required?.length > 0 && <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">Required model(s) missing: {o.missing_required.join(", ")} — download below.</p>}
          <ul className="divide-y hairline">
            {o.installed?.map((m: any) => {
              const n = m.name.replace(/:latest$/, "");
              const activeChat = n === o.active_chat_model.replace(/:latest$/, "");
              const activeEmb = n === o.active_embedding_model.replace(/:latest$/, "");
              const isEmb = m.catalogue?.role === "embedding" || /embed/.test(n);
              return (
                <li key={m.name} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <Cpu className="h-4 w-4" /><span className="flex-1 font-medium">{m.name}</span>
                  <span className="muted text-xs">{m.parameter_size} · {m.quantization} · {m.size_gb} GB</span>
                  {(activeChat || activeEmb) ? <Badge tone="accent">active {activeEmb ? "embedding" : "chat"}</Badge> :
                    <Button size="sm" onClick={async () => { try { const r = await api.post("/api/models/active", isEmb ? { embedding_model: m.name } : { chat_model: m.name }); if (r.note) alert(r.note); load(); } catch (e: any) { setErr(e.message); } }}>Use for {isEmb ? "embeddings" : "chat"}</Button>}
                  {!(activeChat || activeEmb) && <Button size="sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={async () => { const c = prompt(`Remove ${m.name} from disk? Type the model name to confirm.`); if (c === m.name) { await api.post("/api/models/delete", { model: m.name, confirm: c }); load(); } }}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Approved downloads">
          <ul className="space-y-2 text-sm">
            {o.catalogue?.map((c: any) => {
              const installed = o.installed?.some((m: any) => m.name.replace(/:latest$/, "") === c.name);
              const job = o.pulls?.find((p: any) => p.model === c.name && !p.done);
              return (
                <li key={c.name} className="rounded-lg border hairline p-2.5">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.name}</span>{installed ? <Badge tone="accent">installed</Badge> : job ? <Badge>{job.pct}%</Badge> : <Button size="sm" onClick={() => pull(c.name)}><Download className="h-3.5 w-3.5" /> {c.size_gb} GB</Button>}</div>
                  <div className="muted mt-1 text-xs">{c.note}</div>
                  {job && <Progress className="mt-2" value={job.pct} />}
                </li>
              );
            })}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) pull(custom.trim()); }}>
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Other Ollama model, e.g. phi4-mini" />
            <Button type="submit">Check</Button>
          </form>
          {o.pulls?.filter((p: any) => p.done && p.error).map((p: any) => <p key={p.model} className="mt-2 text-xs text-red-600">{p.model}: {p.error}</p>)}
        </Card>
      </div>
    </>
  );
}
