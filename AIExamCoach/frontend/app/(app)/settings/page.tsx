"use client";
import { Download, HardDrive, Shield, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, PageHeader, Spinner } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { useApp } from "@/lib/app-context";

const MODES = [
  { v: "local_only", t: "Local only", d: "Accessible only on this Windows PC (127.0.0.1)." },
  { v: "lan", t: "Local network", d: "Devices on the same Wi-Fi/LAN can sign in (requires the Private-network firewall rule from scripts\\network.ps1)." },
  { v: "tailscale", t: "Secure remote (Tailscale)", d: "Private HTTPS across networks via Tailscale Serve. The app still binds to localhost only." },
];

export default function SettingsPage() {
  const { pid, user, refresh } = useApp();
  const [s, setS] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [a, b, c, d] = await Promise.all([api.get("/api/settings"), api.get("/api/system/status"), api.get("/api/backups"), api.get("/api/audit?limit=50")]);
    setS(a); setSt(b); setBackups(c); setAudit(d);
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);
  const save = async (changes: any) => {
    setErr(null); setMsg(null);
    try { const r = await api.patch("/api/settings", changes); setS(r.settings); setMsg(r.restart_required ? "Saved. Restart the app (scripts\\restart.ps1) for network changes to apply." : "Saved."); } catch (e: any) { setErr(e.message); }
  };
  if (!s || !st) return <Spinner />;
  return (
    <>
      <PageHeader title="Settings" subtitle="Access mode, local AI, documents, revision, backups and security." />
      <ErrorNote error={err} />
      {msg && <div className="mb-3 rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-sm text-[#3f6212] dark:bg-lime-950/40 dark:text-lime-300">{msg}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Wifi className="h-4 w-4" /> Access mode</span>}>
          <div className="space-y-2">
            {MODES.map((m) => (
              <label key={m.v} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${s.access_mode === m.v ? "border-[var(--color-accent-strong)]" : "hairline"}`}>
                <input type="radio" name="mode" checked={s.access_mode === m.v} onChange={() => save({ access_mode: m.v })} className="mt-1" />
                <div><div className="text-sm font-medium">{m.t}</div><div className="muted text-xs">{m.d}</div></div>
              </label>
            ))}
          </div>
          <div className="mt-3 text-sm"><div className="text-xs font-semibold">Current addresses</div><ul className="muted mt-1 text-xs">{st.urls.map((u: string) => <li key={u}><code>{u}</code></li>)}</ul>
            {st.tailscale_ips?.length > 0 && <div className="muted mt-1 text-xs">Tailscale IP detected: {st.tailscale_ips.join(", ")}</div>}</div>
          <p className="muted mt-3 text-[11px]">Port {s.port}. The Ollama API (11434) is never exposed — only this app is reachable. See docs\REMOTE_ACCESS.md for MacBook and iPhone setup.</p>
        </Card>

        <Card title="System status">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Ollama</span>{st.ollama.available ? <Badge tone="accent">running {st.ollama.version}</Badge> : <Badge tone="danger">offline</Badge>}</li>
            <li className="flex justify-between"><span>Loaded models</span><span className="muted">{st.ollama.loaded.join(", ") || "none"}</span></li>
            <li className="flex justify-between"><span>Database (SQLite)</span>{st.database.ok ? <Badge tone="accent">healthy · {st.database.tables} tables</Badge> : <Badge tone="danger">{st.database.integrity}</Badge>}</li>
            <li className="flex justify-between"><span>Vector store (ChromaDB)</span>{st.vector_store.ok ? <Badge tone="accent">{st.vector_store.vectors} vectors</Badge> : <Badge tone="danger">error</Badge>}</li>
            <li className="flex justify-between"><span>OCR (Tesseract)</span>{st.ocr.available ? <Badge tone="accent">available</Badge> : <Badge tone="warn">not installed</Badge>}</li>
            <li className="flex justify-between"><span>Local-only AI</span><Badge tone="dark"><Shield className="mr-1 h-3 w-3" />enforced</Badge></li>
          </ul>
        </Card>

        <Card title="Local AI & documents">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Context length (tokens)" hint="4096 is safe for 6 GB VRAM; try 8192 if memory allows"><select value={s.context_length} onChange={(e) => save({ context_length: Number(e.target.value) })}><option value={4096}>4096</option><option value={6144}>6144</option><option value={8192}>8192</option></select></Field>
            <Field label="Keep model loaded"><select value={s.keep_alive} onChange={(e) => save({ keep_alive: e.target.value })}><option value="2m">2 minutes</option><option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="0">Unload immediately</option></select></Field>
            <Field label="Max upload (MB)"><input type="number" defaultValue={s.max_upload_mb} onBlur={(e) => save({ max_upload_mb: Number(e.target.value) })} /></Field>
            <Field label="Chunk size (tokens)"><input type="number" defaultValue={s.chunk_tokens} onBlur={(e) => save({ chunk_tokens: Number(e.target.value) })} /></Field>
            <Field label="OCR language" hint="Tesseract code, e.g. eng, eng+hin"><input defaultValue={s.ocr_language} onBlur={(e) => save({ ocr_language: e.target.value })} /></Field>
            <Field label="Low OCR confidence (%)"><input type="number" defaultValue={s.ocr_low_confidence} onBlur={(e) => save({ ocr_low_confidence: Number(e.target.value) })} /></Field>
          </div>
          <p className="muted mt-2 text-[11px]">Chat model: {s.chat_model} · Embedding model: {s.embedding_model} (change in Model Manager).</p>
        </Card>

        <Card title="Coaching">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default target %"><input type="number" defaultValue={s.default_target_pct} onBlur={(e) => save({ default_target_pct: Number(e.target.value) })} /></Field>
            <Field label="Max realistic hours / day"><input type="number" defaultValue={s.max_daily_study_hours} onBlur={(e) => save({ max_daily_study_hours: Number(e.target.value) })} /></Field>
            <Field label="Spaced-repetition intervals (days)" hint="First reviews; later intervals grow with ease"><input defaultValue={s.srs_initial_intervals.join(", ")} onBlur={(e) => save({ srs_initial_intervals: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} /></Field>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><HardDrive className="h-4 w-4" /> Backup & export</span>}>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { const b = await api.post("/api/backups"); setMsg(`Backup created: ${b.name} (${b.size_mb} MB)`); setBackups(await api.get("/api/backups")); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>Create backup now</Button>
            {pid && <a href={`/api/profiles/${pid}/export`}><Button><Download className="h-4 w-4" /> Export active profile (JSON)</Button></a>}
          </div>
          <ul className="mt-3 divide-y hairline text-sm">{backups.slice(0, 8).map((b) => <li key={b.name} className="flex items-center justify-between gap-2 py-1.5"><span className="truncate text-xs">{b.name}</span><span className="muted shrink-0 text-xs">{b.size_mb} MB <a className="underline" href={`/api/backups/${b.name}`}>download</a></span></li>)}</ul>
          <p className="muted mt-2 text-[11px]">Backups are stored in data\backups. Restore with scripts\restore.ps1 (it validates the backup and asks before overwriting).</p>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Security</span>}>
          <div className="text-sm">Signed in as <strong>{user?.username}</strong></div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input type="password" placeholder="Current password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} autoComplete="current-password" />
            <input type="password" placeholder="New password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} autoComplete="new-password" />
          </div>
          <Button className="mt-2" onClick={async () => { try { await api.post("/api/auth/change-password", pw); setMsg("Password changed; other sessions were signed out."); setPw({ current_password: "", new_password: "" }); } catch (e: any) { setErr(e.message); } }}>Change password</Button>
          <div className="mt-4 text-xs font-semibold">Recent audit log</div>
          <ul className="mt-1 max-h-48 overflow-y-auto text-xs">{audit.map((a, i) => <li key={i} className={`flex justify-between gap-2 py-0.5 ${a.ok ? "" : "text-red-600"}`}><span>{a.action} {a.detail && <span className="muted">{a.detail.slice(0, 40)}</span>}</span><span className="muted shrink-0">{a.ip} · {fmtDate(a.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>
        </Card>
      </div>
    </>
  );
}
