"use client";
// Minimal, safe Markdown renderer (no raw HTML injection). Supports headings,
// lists, bold/italic, inline code, fenced code, rules, internal links and the
// tutor's <details><summary>Answer</summary>…</details> reveal blocks.
import Link from "next/link";
import { Fragment } from "react";

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]+\)|\[S\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("[S")) out.push(<sup key={k} className="ml-0.5 rounded bg-[var(--color-accent-soft)] px-1 text-[10px] font-semibold text-[#3f6212] dark:bg-lime-950/50 dark:text-lime-300">{t.slice(1, -1)}</sup>);
    else if (t.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!;
      const href = mm[2];
      out.push(href.startsWith("/") ? <Link key={k} href={href}>{mm[1]}</Link> : <span key={k}>{mm[1]}</span>); // external links not rendered as links
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={key}><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    const det = /^\s*<details><summary>(.*?)<\/summary>(.*?)<\/details>\s*$/.exec(line);
    if (det) {
      blocks.push(<details key={key}><summary>{det[1]}</summary><div className="mt-1">{inline(det[2], key)}</div></details>);
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const content = inline(h[2], key);
      blocks.push(lvl === 1 ? <h1 key={key}>{content}</h1> : lvl === 2 ? <h2 key={key}>{content}</h2> : <h3 key={key}>{content}</h3>);
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(<ul key={key}>{items.map((t, j) => <li key={j}>{inline(t, `${key}-${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && (/^\s*\d+[.)]\s+/.test(lines[i]) || /^\s{2,}<details>/.test(lines[i]) || lines[i].trim() === "")) {
        const l = lines[i++];
        if (!l.trim()) {
          if (i < lines.length && !/^\s*\d+[.)]\s+|^\s{2,}<details>/.test(lines[i])) break;
          continue;
        }
        const d = /^\s*<details><summary>(.*?)<\/summary>(.*?)<\/details>/.exec(l);
        if (d && items.length) {
          const prev = items.pop();
          items.push(<li key={items.length}>{prev}<details><summary>{d[1]}</summary><div className="mt-1">{inline(d[2], `${key}d${i}`)}</div></details></li>);
        } else items.push(<Fragment key={items.length}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), `${key}-${i}`)}</Fragment>);
      }
      blocks.push(<ol key={key}>{items.map((it, j) => (it && (it as React.ReactElement).type === "li" ? it : <li key={j}>{it}</li>))}</ol>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*---\s*$)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={key}>{para.flatMap((p, j) => (j ? [<br key={`br${j}`} />, ...inline(p, `${key}-${j}`)] : inline(p, `${key}-${j}`)))}</p>);
  }
  return <div className="prose-coach">{blocks}</div>;
}
