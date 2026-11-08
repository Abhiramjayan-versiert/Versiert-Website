"use client";
// Small, restrained SVG charts (monochrome + one accent).

export function LineChart({ points, target, height = 160 }: { points: { label: string; value: number }[]; target?: number; height?: number }) {
  if (!points.length) return <div className="muted text-sm">No data yet.</div>;
  const w = 600;
  const pad = { l: 30, r: 10, t: 10, b: 22 };
  const x = (i: number) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - v / 100) * (height - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full" role="img" aria-label="Score trend">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={w - pad.r} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth="1" />
          <text x={4} y={y(g) + 4} fontSize="10" fill="var(--muted)">{g}</text>
        </g>
      ))}
      {target !== undefined && <line x1={pad.l} x2={w - pad.r} y1={y(target)} y2={y(target)} stroke="var(--color-accent-strong)" strokeDasharray="4 4" strokeWidth="1.5" />}
      <path d={d} fill="none" stroke="var(--fg)" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3.5" fill={target !== undefined && p.value >= target ? "var(--color-accent-strong)" : "var(--fg)"}>
            <title>{`${p.label}: ${p.value}%`}</title>
          </circle>
          {(points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && <text x={x(i)} y={height - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{p.label}</text>}
        </g>
      ))}
    </svg>
  );
}

export function BarList({ items, target, unit = "%" }: { items: { label: string; value: number; sub?: string }[]; target?: number; unit?: string }) {
  if (!items.length) return <div className="muted text-sm">No data yet.</div>;
  const max = unit === "%" ? 100 : Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span className="truncate">{it.label}</span>
            <span className="muted shrink-0">{it.value}{unit}{it.sub ? ` · ${it.sub}` : ""}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--subtle)]">
            <div className={`h-full rounded-full ${target !== undefined && it.value >= target ? "bg-[var(--color-accent-strong)]" : "bg-[#3a3a40] dark:bg-[#cfcfd4]"}`} style={{ width: `${(100 * it.value) / max}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MinutesBars({ data }: { data: { day: string; minutes: number }[] }) {
  if (!data.length) return <div className="muted text-sm">No study time logged yet.</div>;
  const last = data.slice(-30);
  const max = Math.max(...last.map((d) => d.minutes), 60);
  return (
    <div className="flex h-24 items-end gap-[3px]" role="img" aria-label="Study minutes per day">
      {last.map((d) => (
        <div key={d.day} className="flex-1 rounded-t bg-[#3a3a40] dark:bg-[#cfcfd4]" style={{ height: `${Math.max(4, (100 * d.minutes) / max)}%` }} title={`${d.day}: ${d.minutes} min`} />
      ))}
    </div>
  );
}
