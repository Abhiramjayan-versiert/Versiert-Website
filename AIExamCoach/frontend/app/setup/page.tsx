"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { api } from "@/lib/api";

export default function Setup() {
  const router = useRouter();
  const [f, setF] = useState({ username: "", display_name: "", password: "", confirm: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/api/auth/status").then((s) => !s.setup_required && router.replace("/login/")).catch(() => {});
  }, [router]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setErr("Passwords do not match.");
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/setup", { username: f.username, password: f.password, display_name: f.display_name });
      window.location.href = "/exams/";
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold">Welcome to your AI Exam Coach</h1>
          <p className="muted mt-1 text-sm">Create the account that protects your study data. Everything — documents, answers, scores and AI — stays on this Windows PC.</p>
        </div>
        <Field label="Username" hint="3-32 letters, digits, . _ -"><input value={f.username} onChange={set("username")} required autoCapitalize="none" autoComplete="username" /></Field>
        <Field label="Your name"><input value={f.display_name} onChange={set("display_name")} /></Field>
        <Field label="Password" hint="At least 10 characters, upper and lower case, and a number"><input type="password" value={f.password} onChange={set("password")} required autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input type="password" value={f.confirm} onChange={set("confirm")} required autoComplete="new-password" /></Field>
        <ErrorNote error={err} />
        <Button variant="primary" className="w-full" loading={busy} type="submit">Create account</Button>
        <p className="muted text-xs">Three exam profiles are created for you: MBA Semester, SSC Competitive and Other Examinations. You can edit or add more.</p>
      </form>
    </div>
  );
}
