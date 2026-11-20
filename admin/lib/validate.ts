import type { Field } from "./schema";

/**
 * Cleans an untrusted value against the field schema:
 * trims strings, drops unknown keys, checks URLs/emails/images/options,
 * fills auto IDs and collects human-readable errors.
 */
export type Ctx = { categories?: string[]; errors: string[] };

const MAX_TEXT = 6000;
const URL_OK = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:[+\d\s()-]+|#[\w-]*|\/[^\s<>"]*)$/i;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IMAGE_OK = /^(\/images\/[a-z0-9/_\-.]+\.(webp|jpe?g|png|svg|avif)|https:\/\/[^\s<>"]+|pending:[a-z0-9-]{6,40})$/i;

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, MAX_TEXT);

function cleanField(f: Field, v: unknown, ctx: Ctx, where: string): unknown {
  const label = where ? `${where} → ${f.label}` : f.label;
  switch (f.type) {
    case "text":
    case "textarea": {
      const s = str(v);
      if (f.required && !s) ctx.errors.push(`${label} is required.`);
      return s;
    }
    case "email": {
      const s = str(v);
      if (f.required && !s) ctx.errors.push(`${label} is required.`);
      else if (s && !EMAIL_OK.test(s)) ctx.errors.push(`${label} isn't a valid email address.`);
      return s;
    }
    case "url": {
      const s = str(v);
      if (f.required && !s) ctx.errors.push(`${label} is required.`);
      else if (s && !URL_OK.test(s)) ctx.errors.push(`${label} must start with https://, /, # or mailto:.`);
      return s;
    }
    case "boolean":
      return v === true;
    case "select": {
      const s = str(v);
      const opts = f.options === "@categories" ? ctx.categories || [] : f.options;
      if (f.required && !s) ctx.errors.push(`${label} is required.`);
      else if (s && !opts.includes(s)) ctx.errors.push(`${label}: “${s}” isn't one of the options.`);
      return s;
    }
    case "image": {
      const s = str(v);
      if (f.required && !s) ctx.errors.push(`${label} is required.`);
      else if (s && !IMAGE_OK.test(s)) ctx.errors.push(`${label} has an invalid image path.`);
      return s;
    }
    case "strings": {
      const arr = Array.isArray(v) ? v : [];
      return arr.map(str).filter(Boolean).slice(0, 200);
    }
    case "group": {
      const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      return cleanObject(f.fields, o, ctx, label);
    }
    case "list": {
      const arr = Array.isArray(v) ? v.slice(0, 300) : [];
      const items = arr.map((item, i) => {
        const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const title = str(o[f.titleKey]) || `${f.itemLabel} ${i + 1}`;
        const clean = cleanObject(f.fields, o, ctx, `${label} → ${title}`);
        if (f.autoId) clean[f.autoId.key] = str(o[f.autoId.key]);
        return clean;
      });
      if (f.autoId) {
        const { key, from } = f.autoId;
        const seen = new Set<string>();
        for (const it of items) {
          let id = slugify(String(it[key] || it[from] || "item"));
          const base = id;
          let n = 2;
          while (seen.has(id)) id = `${base}-${n++}`;
          seen.add(id);
          it[key] = id;
        }
      }
      return items;
    }
  }
}

export function cleanObject(fields: Field[], o: Record<string, unknown>, ctx: Ctx, where = "") {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f.key] = cleanField(f, o[f.key], ctx, where);
  return out;
}

/** A section's value is either an object of fields, or (single key "") the field value itself. */
export function cleanSectionValue(fields: Field[], value: unknown, ctx: Ctx) {
  if (fields.length === 1 && fields[0].key === "") return cleanField(fields[0], value, ctx, "");
  const o = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return cleanObject(fields, o, ctx);
}
