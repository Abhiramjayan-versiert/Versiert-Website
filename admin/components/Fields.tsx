"use client";

import { createContext, useContext, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Copy, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import type { Field } from "@/lib/schema";

/* ---------- image staging (uploads are committed together with the save) ---------- */

export type Staged = { data: string; name: string; preview: string };
type StageCtx = {
  stage: (img: Staged) => string;
  get: (id: string) => Staged | undefined;
  categories: string[];
};
export const StagingContext = createContext<StageCtx>({ stage: () => "", get: () => undefined, categories: [] });

/** Where previews of existing website images come from. */
export function previewSrc(value: string, staged?: Staged) {
  if (value.startsWith("pending:")) return staged?.preview || "";
  if (value.startsWith("/images/")) return `/api/asset?path=${encodeURIComponent(value)}`;
  if (value.startsWith("https://")) return value;
  return "";
}

async function compressImage(file: File, maxWidth: number): Promise<{ data: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.8));
  if (!blob || blob.type !== "image/webp") blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't process this image.");
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(blob!);
  });
  return { data: dataUrl.split(",")[1], preview: URL.createObjectURL(blob) };
}

/* ---------- shared bits ---------- */

function Label({ id, field, children }: { id: string; field: Field; children?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-end justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium text-white/85">
        {field.label}
        {field.required && <span className="text-tungsten"> *</span>}
      </label>
      {children}
    </div>
  );
}
const Help = ({ text }: { text?: string }) => (text ? <p className="mt-1.5 text-xs leading-relaxed text-white/45">{text}</p> : null);

const move = <T,>(arr: T[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/* ---------- field renderer ---------- */

export function FieldView({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const id = useId();
  switch (field.type) {
    case "text":
    case "url":
    case "email":
      return (
        <div>
          <Label id={id} field={field} />
          <input
            id={id}
            className="input"
            type={field.type === "email" ? "email" : field.type === "url" ? "text" : "text"}
            inputMode={field.type === "url" ? "url" : field.type === "email" ? "email" : undefined}
            value={String(value ?? "")}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          <Help text={field.help} />
        </div>
      );
    case "textarea":
      return (
        <div>
          <Label id={id} field={field} />
          <textarea id={id} className="input" value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
          <Help text={field.help} />
        </div>
      );
    case "boolean":
      return (
        <div className="flex items-start gap-3">
          <button
            id={id}
            type="button"
            role="switch"
            aria-checked={value === true}
            onClick={() => onChange(!(value === true))}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${value === true ? "bg-tungsten" : "bg-white/15"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value === true ? "translate-x-[22px]" : "translate-x-0.5"}`} />
          </button>
          <div>
            <label htmlFor={id} className="text-sm font-medium text-white/85">
              {field.label}
            </label>
            <Help text={field.help} />
          </div>
        </div>
      );
    case "select":
      return <SelectField id={id} field={field} value={String(value ?? "")} onChange={onChange} />;
    case "image":
      return <ImageField id={id} field={field} value={String(value ?? "")} onChange={onChange} />;
    case "strings":
      return <StringsField id={id} field={field} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;
    case "group": {
      const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      return (
        <fieldset className="min-w-0 rounded-xl border border-white/10 p-4 sm:p-5">
          <legend className="px-1.5 text-sm font-medium text-white/85">{field.label}</legend>
          <Help text={field.help} />
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-5">
            {field.fields.map((f) => (
              <FieldView key={f.key} field={f} value={o[f.key]} onChange={(v) => onChange({ ...o, [f.key]: v })} />
            ))}
          </div>
        </fieldset>
      );
    }
    case "list":
      return <ListField field={field} value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []} onChange={onChange} />;
  }
}

function SelectField({ id, field, value, onChange }: { id: string; field: Extract<Field, { type: "select" }>; value: string; onChange: (v: unknown) => void }) {
  const { categories } = useContext(StagingContext);
  const options = field.options === "@categories" ? categories : field.options;
  const unknown = value && !options.includes(value);
  return (
    <div>
      <Label id={id} field={field} />
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">Choose…</option>}
        {unknown && <option value={value}>{value} (not in list)</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <Help text={field.help} />
    </div>
  );
}

function StringsField({ id, field, value, onChange }: { id: string; field: Extract<Field, { type: "strings" }>; value: string[]; onChange: (v: unknown) => void }) {
  return (
    <div>
      <Label id={`${id}-0`} field={field} />
      <ul className="space-y-2">
        {value.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <input
              id={`${id}-${i}`}
              className="input"
              value={s}
              aria-label={`${field.itemLabel || "Item"} ${i + 1}`}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button type="button" className="btn btn-icon" onClick={() => onChange(move(value, i, -1))} disabled={i === 0} aria-label="Move up">
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" className="btn btn-icon" onClick={() => onChange(move(value, i, 1))} disabled={i === value.length - 1} aria-label="Move down">
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" className="btn btn-icon hover:!text-bad" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${field.itemLabel || "item"} ${i + 1}`}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white" onClick={() => onChange([...value, ""])}>
        <Plus className="h-4 w-4" aria-hidden /> Add {field.itemLabel?.toLowerCase() || "item"}
      </button>
      <Help text={field.help} />
    </div>
  );
}

function ImageField({ id, field, value, onChange }: { id: string; field: Extract<Field, { type: "image" }>; value: string; onChange: (v: unknown) => void }) {
  const { stage, get } = useContext(StagingContext);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const staged = value.startsWith("pending:") ? get(value.slice(8)) : undefined;
  const src = previewSrc(value, staged);

  const onFile = async (file?: File) => {
    if (!file) return;
    setErr("");
    if (!/^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|avif|heic)$/i.test(file.name)) {
      setErr("Choose a JPG, PNG or WebP image.");
      return;
    }
    setBusy(true);
    try {
      const { data, preview } = await compressImage(file, field.maxWidth || 2000);
      if (data.length * 0.75 > 3.4 * 1024 * 1024) throw new Error("This image is still too large after compression. Try a smaller one.");
      onChange(`pending:${stage({ data, name: file.name, preview })}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read this image.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div>
      <Label id={id} field={field} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
          className="group relative w-full shrink-0 overflow-hidden rounded-lg border border-dashed border-white/20 bg-black hover:border-white/50 sm:w-56"
          style={{ aspectRatio: field.aspect || "16/10" }}
          aria-label={src ? `Replace ${field.label}` : `Upload ${field.label}`}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/50">
              <ImagePlus className="h-6 w-6" aria-hidden /> Upload image
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : src ? "Replace" : "Upload"}
          </span>
          {staged && <span className="pill absolute left-2 top-2 bg-tungsten text-black">New: saves with this page</span>}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            id={id}
            className="input font-mono text-xs"
            value={value.startsWith("pending:") ? `New upload: ${staged?.name || ""}` : value}
            readOnly={value.startsWith("pending:")}
            onChange={(e) => onChange(e.target.value)}
            placeholder="/images/… or https://…"
            aria-label={`${field.label} path`}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost h-9" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
              {src ? "Replace" : "Upload"}
            </button>
            {value && (
              <button type="button" className="btn btn-ghost h-9" onClick={() => onChange("")}>
                Remove
              </button>
            )}
          </div>
          {err && <p className="text-xs text-bad">{err}</p>}
          <Help text={field.help} />
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
    </div>
  );
}

function ListField({ field, value, onChange }: { field: Extract<Field, { type: "list" }>; value: Record<string, unknown>[]; onChange: (v: unknown) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const add = () => {
    onChange([...value, structuredClone(field.template)]);
    setOpen(value.length);
  };
  return (
    <div>
      {field.label && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white/85">
              {field.label} <span className="text-white/40">({value.length})</span>
            </p>
            <Help text={field.help} />
          </div>
        </div>
      )}
      <ul className="space-y-2">
        {value.map((item, i) => {
          const title = String(item[field.titleKey] || "") || `Untitled ${field.itemLabel.toLowerCase()}`;
          const sub = field.subtitleKey ? String(item[field.subtitleKey] || "") : "";
          const isOpen = open === i;
          return (
            <li key={i} className={`rounded-xl border transition-colors ${isOpen ? "border-white/25 bg-raise" : "border-white/10 bg-black/30"}`}>
              <div className="flex items-center gap-1 p-2 pl-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-white/50 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 truncate text-sm font-medium">
                      {title}
                      {item.isSample === true && <span className="pill bg-tungsten/15 text-tungsten">Sample</span>}
                    </span>
                    {sub && <span className="block truncate text-xs text-white/45">{sub}</span>}
                  </span>
                </button>
                <button type="button" className="btn btn-icon" onClick={() => { onChange(move(value, i, -1)); setOpen(isOpen ? i - 1 : open); }} disabled={i === 0} aria-label={`Move ${title} up`}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" className="btn btn-icon" onClick={() => { onChange(move(value, i, 1)); setOpen(isOpen ? i + 1 : open); }} disabled={i === value.length - 1} aria-label={`Move ${title} down`}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => {
                    const copy = structuredClone(item);
                    if (field.autoId) copy[field.autoId.key] = "";
                    copy[field.titleKey] = `${String(item[field.titleKey] || "")} (copy)`;
                    onChange([...value.slice(0, i + 1), copy, ...value.slice(i + 1)]);
                    setOpen(i + 1);
                  }}
                  aria-label={`Duplicate ${title}`}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn-icon hover:!text-bad"
                  onClick={() => {
                    if (confirm(`Remove “${title}”? You can still discard changes before saving.`)) {
                      onChange(value.filter((_, j) => j !== i));
                      setOpen(null);
                    }
                  }}
                  aria-label={`Remove ${title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              {isOpen && (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-5 border-t border-white/10 p-4 sm:p-5">
                  {field.fields.map((f) => (
                    <FieldView key={f.key} field={f} value={item[f.key]} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))} />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-ghost mt-3" onClick={add}>
        <Plus className="h-4 w-4" aria-hidden /> Add {field.itemLabel.toLowerCase()}
      </button>
    </div>
  );
}
