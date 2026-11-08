"use client";
import { UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, confirmText } from "./ui";
import { api, fmtDate } from "@/lib/api";

/** Administrator: create and manage accounts for other people. */
export default function UsersAdmin({ meId }: { meId: number }) {
  const [users, setUsers] = useState<any[]>([]);
  const [f, setF] = useState({ username: "", display_name: "", password: "", is_admin: false });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.get("/api/users").then(setUsers).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<any>, ok: string) => {
    setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); load(); } catch (e: any) { setErr(e.message); }
  };
  const create = () => act(async () => {
    await api.post("/api/users", f);
    setF({ username: "", display_name: "", password: "", is_admin: false });
  }, `Account "${f.username}" created. Give them the username and temporary password — they will be asked to choose their own.`);

  return (
    <Card title={<span className="flex items-center gap-2"><Users className="h-4 w-4" /> Users</span>} className="lg:col-span-2">
      <p className="muted mb-3 text-xs">Each person gets their own exam profiles, documents, plans, scores and revision. Nobody can see anyone else&apos;s data. All AI still runs on this PC, one request at a time, so with several people studying at once requests queue briefly.</p>
      <ErrorNote error={err} />
      {msg && <div className="mb-3 rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-sm text-[#3f6212] dark:bg-lime-950/40 dark:text-lime-300">{msg}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="muted text-left text-xs"><tr className="border-b hairline"><th className="py-2">User</th><th>Role</th><th>Status</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b hairline">
                <td className="py-2"><div className="font-medium">{u.display_name}</div><div className="muted text-xs">{u.username}</div></td>
                <td>{u.is_admin ? <Badge tone="dark">admin</Badge> : <Badge>student</Badge>}</td>
                <td>{u.disabled ? <Badge tone="danger">disabled</Badge> : u.must_change_password ? <Badge tone="warn">temporary password</Badge> : <Badge tone="accent">active</Badge>}</td>
                <td className="muted text-xs">{u.last_seen ? fmtDate(u.last_seen, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"}</td>
                <td className="py-2 text-right">
                  {u.id === meId ? <span className="muted text-xs">you</span> : (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { const p = prompt(`New temporary password for ${u.username} (10+ chars, upper & lower case, a number):`); if (p) act(() => api.patch(`/api/users/${u.id}`, { reset_password: p }), `Password reset for ${u.username}. They have been signed out.`); }}>Reset password</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? `${u.username} enabled.` : `${u.username} disabled and signed out.`)}>{u.disabled ? "Enable" : "Disable"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/users/${u.id}`, { is_admin: !u.is_admin }), "Role updated.")}>{u.is_admin ? "Remove admin" : "Make admin"}</Button>
                      <Button size="sm" variant="danger" onClick={() => { if (confirmText(`Permanently delete ${u.username} and ALL their exams, documents, scores and revision data?`, u.username)) act(() => api.del(`/api/users/${u.id}?confirm=${encodeURIComponent(u.username)}`), `${u.username} deleted.`); }}>Delete</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-xl border hairline p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><UserPlus className="h-4 w-4" /> Add a user</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Username" hint="3-32 letters, digits, . _ -"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" autoComplete="off" /></Field>
          <Field label="Name"><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
          <Field label="Temporary password" hint="10+ chars, upper & lower case, a number"><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_admin} onChange={(e) => setF({ ...f, is_admin: e.target.checked })} /> Administrator (can manage users, models, settings, backups)</label>
          <Button variant="primary" onClick={create} disabled={!f.username || !f.password}>Create account</Button>
        </div>
      </div>
    </Card>
  );
}
