"use client";
import { Loader2, X } from "lucide-react";
import { useEffect } from "react";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean };

export function Button({ variant = "secondary", size = "md", loading, className = "", children, disabled, ...p }: BtnProps) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
  const sizes = size === "sm" ? "text-xs px-2.5 py-1.5" : "text-sm px-3.5 py-2";
  const variants = {
    primary: "bg-[var(--color-accent)] text-[#0b0b0c] hover:bg-[#b5ef4f]",
    secondary: "border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--subtle)]",
    ghost: "hover:bg-[var(--subtle)]",
    danger: "border border-red-300/60 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40",
  }[variant];
  return (
    <button className={`${base} ${sizes} ${variants} ${className}`} disabled={disabled || loading} {...p}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "dark" }) {
  const t = {
    neutral: "bg-[var(--subtle)] text-[var(--muted)]",
    accent: "bg-[var(--color-accent-soft)] text-[#3f6212] dark:bg-lime-950/50 dark:text-lime-300",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    danger: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    dark: "bg-[#1c1c1f] text-white",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>;
}

export function Progress({ value, target, className = "" }: { value: number | null | undefined; target?: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={`relative h-2 w-full overflow-hidden rounded-full bg-[var(--subtle)] ${className}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${target !== undefined && v < target ? "bg-[#3a3a40] dark:bg-[#d4d4d8]" : "bg-[var(--color-accent-strong)]"}`} style={{ width: `${v}%` }} />
      {target !== undefined && <div className="absolute top-0 h-full w-0.5 bg-[var(--color-accent-strong)]" style={{ left: `${target}%` }} title={`Target ${target}%`} />}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <div className="muted text-xs">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="muted mt-0.5 text-xs">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed hairline p-6 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="muted mt-1 text-sm">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="muted flex items-center gap-2 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="muted mt-1 block text-[11px]">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card max-h-[90dvh] w-full overflow-y-auto rounded-b-none p-5 sm:rounded-b-[14px] ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-[var(--subtle)]"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex flex-wrap rounded-[10px] border hairline bg-[var(--card)] p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`rounded-[8px] px-3 py-1.5 text-xs font-medium ${value === o.value ? "bg-[#1c1c1f] text-white dark:bg-white dark:text-black" : "muted hover:text-[var(--fg)]"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function confirmText(message: string, expected: string): boolean {
  const v = window.prompt(`${message}\n\nType "${expected}" to confirm:`);
  return v === expected;
}
