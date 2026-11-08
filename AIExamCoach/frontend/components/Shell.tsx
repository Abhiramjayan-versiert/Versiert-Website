"use client";
import {
  Activity, BarChart3, BookOpen, Bot, CalendarDays, ClipboardCheck, Cpu, FileText, GraduationCap, LayoutDashboard, Library,
  ListChecks, Menu, MessageSquare, RotateCcw, Settings, Timer, WifiOff, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AppProvider, useApp } from "@/lib/app-context";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/coach/", label: "AI Exam Coach", icon: MessageSquare },
  { href: "/tutor/", label: "AI Tutor", icon: GraduationCap },
  { href: "/exams/", label: "My Examinations", icon: BookOpen },
  { href: "/syllabus/", label: "Syllabus", icon: ListChecks },
  { href: "/planner/", label: "Study Planner", icon: CalendarDays },
  { href: "/questions/", label: "Question Bank", icon: FileText },
  { href: "/mocks/", label: "Mock Exams", icon: Timer },
  { href: "/evaluate/", label: "Answer Evaluation", icon: ClipboardCheck },
  { href: "/revision/", label: "Revision Centre", icon: RotateCcw },
  { href: "/analytics/", label: "Performance Analytics", icon: BarChart3 },
  { href: "/documents/", label: "Document Library", icon: Library },
  { href: "/agents/", label: "Agent Activity", icon: Activity },
  { href: "/models/", label: "Model Manager", icon: Cpu, admin: true },
  { href: "/settings/", label: "Settings", icon: Settings },
];
const MOBILE = [NAV[0], NAV[1], NAV[7], NAV[9]];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

function ProfileSwitcher() {
  const { profiles, pid, setActive } = useApp();
  if (!profiles.length) return null;
  return (
    <select aria-label="Active examination profile" value={pid ?? ""} onChange={(e) => setActive(Number(e.target.value)).then(() => window.location.reload())}
      className="!border-white/10 !bg-white/5 !text-white !text-xs">
      {profiles.map((p) => <option key={p.id} value={p.id} className="text-black">{p.name}</option>)}
    </select>
  );
}

function Sidebar({ onNav }: { onNav?: () => void }) {
  const path = usePathname();
  const { user } = useApp();
  return (
    <div className="flex h-full flex-col bg-[#0b0b0c] text-[#d4d4d8]">
      <div className="flex items-center gap-2 px-4 pb-3 pt-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent)] text-[#0b0b0c]"><Bot className="h-4 w-4" /></div>
        <div>
          <div className="text-sm font-semibold text-white">Exam Coach</div>
          <div className="text-[10px] text-[#8a8a93]">Local AI · private</div>
        </div>
      </div>
      <div className="px-3 pb-3"><ProfileSwitcher /></div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4" aria-label="Main">
        {NAV.filter((n) => !(n as { admin?: boolean }).admin || user?.is_admin).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={onNav}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${isActive(path, href) ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white"}`}>
            <Icon className={`h-4 w-4 ${isActive(path, href) ? "text-[var(--color-accent)]" : ""}`} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-3 text-xs">
        <div className="truncate text-white">{user?.display_name}{user?.is_admin && <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[#d4d4d8]">admin</span>}</div>
        <button className="mt-1 text-[#8a8a93] hover:text-white" onClick={async () => { await api.post("/api/auth/logout"); window.location.href = "/login/"; }}>Sign out</button>
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const { online, user } = useApp();
  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block"><Sidebar /></aside>
      {/* mobile top bar */}
      <header className="pt-safe sticky top-0 z-20 flex items-center justify-between border-b hairline bg-[var(--bg)]/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-[var(--subtle)]"><Menu className="h-5 w-5" /></button>
        <div className="text-sm font-semibold">Exam Coach</div>
        <div className="w-8" />
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="pt-safe absolute inset-y-0 left-0 w-72 max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-4 z-10 rounded-md p-1 text-white"><X className="h-5 w-5" /></button>
            <Sidebar onNav={() => setOpen(false)} />
          </div>
        </div>
      )}
      {!online && (
        <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="alert">
          <WifiOff className="h-4 w-4" /> The Windows host is offline or unreachable. It must stay powered on and connected for remote access.
        </div>
      )}
      {user?.must_change_password && !path.startsWith("/settings") && (
        <div className="flex flex-wrap items-center gap-2 bg-[var(--color-accent-soft)] px-4 py-2 text-sm text-[#3f6212] dark:bg-lime-950/50 dark:text-lime-200" role="status">
          You are using a temporary password. <Link href="/settings/" className="font-semibold underline">Choose your own password</Link>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-6 lg:pb-10 lg:pt-8">{children}</main>
      {/* mobile bottom nav */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t hairline bg-[var(--card)] lg:hidden" aria-label="Quick">
        {MOBILE.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive(path, href) ? "font-semibold" : "muted"}`}>
            <Icon className={`h-5 w-5 ${isActive(path, href) ? "text-[var(--color-accent-strong)]" : ""}`} />
            {label.replace("AI Exam ", "").replace(" Centre", "")}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="muted flex flex-col items-center gap-0.5 py-2 text-[10px]"><Menu className="h-5 w-5" />More</button>
      </nav>
    </div>
  );
}

/** Auth gate + layout for every signed-in page. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok">("loading");
  useEffect(() => {
    api.get<{ setup_required: boolean; authenticated: boolean }>("/api/auth/status")
      .then((s) => {
        if (s.setup_required) router.replace("/setup/");
        else if (!s.authenticated) router.replace("/login/");
        else setState("ok");
      })
      .catch(() => setState("ok"));
  }, [router]);
  if (state === "loading") return <div className="muted p-8 text-sm">Loading…</div>;
  return (
    <AppProvider>
      <Frame>{children}</Frame>
    </AppProvider>
  );
}
