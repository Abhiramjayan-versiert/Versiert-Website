"use client";
export const QTYPES: [string, string][] = [["mcq", "MCQ"], ["msq", "Multiple-select"], ["true_false", "True / false"], ["fill_blank", "Fill in the blanks"],
  ["short_answer", "Short answer"], ["long_answer", "Long answer"], ["case_study", "Case study"], ["numerical", "Numerical"], ["assertion_reason", "Assertion & reason"], ["essay", "Essay"]];
export const qLabel = (t: string) => QTYPES.find((q) => q[0] === t)?.[1] ?? t;

export function AnswerView({ q }: { q: any }) {
  const a = q.answer ?? {};
  if (["mcq", "msq", "assertion_reason"].includes(q.qtype)) return <div className="text-sm">Answer: <strong>{(a.correct ?? []).map((i: number) => `${String.fromCharCode(65 + i)}. ${q.options[i]}`).join("; ")}</strong></div>;
  if (q.qtype === "true_false") return <div className="text-sm">Answer: <strong>{a.correct ? "True" : "False"}</strong></div>;
  if (q.qtype === "fill_blank") return <div className="text-sm">Answer: <strong>{(a.accepted ?? [a.correct]).join(" / ")}</strong></div>;
  if (q.qtype === "numerical") return <div className="text-sm">Answer: <strong>{a.value} {a.unit}</strong> {a.expression && <span className="muted">(Python-verified: {a.expression})</span>}</div>;
  return <div className="whitespace-pre-wrap text-sm"><div className="text-xs font-semibold">Model answer</div>{a.model_answer}</div>;
}

