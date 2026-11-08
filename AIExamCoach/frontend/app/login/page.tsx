"use client";
import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/api/auth/status").then((s) => {
      if (s.setup_required) router.replace("/setup/");
      else if (s.authenticated) router.replace("/");
    }).catch((e) => setErr(e.message));
  }, [router]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/login", { username: u, password: p });
      window.location.href = "/";
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0b0b0c] text-[var(--color-accent)]"><Bot className="h-4 w-4" /></div>
          <div>
            <h1 className="font-semibold">AI Exam Coach</h1>
            <p className="muted text-xs">Sign in — your data stays on your PC</p>
          </div>
        </div>
        <Field label="Username"><input autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required autoCapitalize="none" /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></Field>
        <ErrorNote error={err} />
        <Button variant="primary" className="w-full" loading={busy} type="submit">Sign in</Button>
      </form>
    </div>
  );
}
