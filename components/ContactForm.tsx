"use client";

import { useEffect, useId, useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { services } from "@/data/services";
import { contact } from "@/data/content";
import { site } from "@/lib/site";
import { ENQUIRE_EVENT } from "@/lib/enquire";

type Values = {
  name: string;
  email: string;
  phone: string;
  project: string;
  service: string;
  budget: string;
  message: string;
  website: string; // honeypot
};

type Errors = Partial<Record<keyof Values, string>>;

const initial: Values = { name: "", email: "", phone: "", project: "", service: "", budget: "", message: "", website: "" };

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent" }
  | { state: "mailto"; href: string }
  | { state: "error"; message: string; href: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(v: Values): Errors {
  const e: Errors = {};
  if (v.name.trim().length < 2) e.name = "Please enter your name.";
  if (!EMAIL_RE.test(v.email.trim())) e.email = "Please enter a valid email address.";
  if (v.phone.trim() && !/^[+\d][\d\s()-]{6,}$/.test(v.phone.trim())) e.phone = "Please enter a valid phone number.";
  if (v.project.trim().length < 2) e.project = "Tell us briefly what the project is.";
  if (!v.service) e.service = "Please choose a service.";
  if (v.message.trim().length < 10) e.message = "Please add a few more details (at least 10 characters).";
  if (v.message.length > 3000) e.message = "Please keep your message under 3000 characters.";
  return e;
}

function buildMailto(v: Values) {
  const subject = `Project enquiry: ${v.project || v.service}`;
  const lines = [
    `Name: ${v.name}`,
    `Email: ${v.email}`,
    v.phone && `Phone: ${v.phone}`,
    `Project: ${v.project}`,
    `Service: ${v.service}`,
    v.budget && `Budget: ${v.budget}`,
  ].filter(Boolean);
  let body = `${lines.join("\n")}\n\n${v.message}`;
  if (body.length > 1600) body = body.slice(0, 1600) + "…";
  return `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ContactForm() {
  const uid = useId();
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [status, setStatus] = useState<Status>({ state: "idle" });

  const hasBackend = Boolean(site.form.web3formsKey || site.form.endpoint);

  // Pre-select a service when an "Enquire" button elsewhere is clicked
  useEffect(() => {
    const onEnquire = (e: Event) => {
      const s = (e as CustomEvent<string | undefined>).detail;
      if (s) {
        setValues((v) => ({ ...v, service: s }));
        setErrors((er) => ({ ...er, service: undefined }));
      }
    };
    window.addEventListener(ENQUIRE_EVENT, onEnquire);
    return () => window.removeEventListener(ENQUIRE_EVENT, onEnquire);
  }, []);

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const next = { ...values, [k]: e.target.value };
    setValues(next);
    if (touched[k]) setErrors(validate(next));
  };
  const blur = (k: keyof Values) => () => {
    setTouched((t) => ({ ...t, [k]: true }));
    setErrors(validate(values));
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (values.website) return; // bot
    const errs = validate(values);
    setErrors(errs);
    setTouched({ name: true, email: true, phone: true, project: true, service: true, message: true });
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }

    const mailto = buildMailto(values);

    if (!hasBackend) {
      window.location.href = mailto;
      setStatus({ state: "mailto", href: mailto });
      return;
    }

    setStatus({ state: "sending" });
    const payload = {
      name: values.name,
      email: values.email,
      phone: values.phone,
      project: values.project,
      service: values.service,
      budget: values.budget || "Not specified",
      message: values.message,
      subject: `New project enquiry — ${values.service}`,
    };

    try {
      let ok = false;
      if (site.form.web3formsKey) {
        const res = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ access_key: site.form.web3formsKey, from_name: "Versiert Media website", ...payload }),
        });
        const json = await res.json().catch(() => ({}));
        ok = res.ok && json?.success !== false;
      } else {
        const res = await fetch(site.form.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        ok = res.ok;
      }
      if (!ok) throw new Error("Request failed");
      setStatus({ state: "sent" });
      setValues(initial);
      setTouched({});
    } catch {
      setStatus({
        state: "error",
        message: "Your message couldn't be sent right now.",
        href: mailto,
      });
    }
  }

  if (status.state === "sent") {
    return (
      <div className="border border-white/15 p-8 md:p-10" role="status">
        <p className="eyebrow">Message received</p>
        <p className="mt-4 text-2xl font-medium tracking-[-0.02em] md:text-3xl">Thank you — your enquiry has been sent.</p>
        <p className="mt-4 text-white/60">We&apos;ll reply to the email address you provided.</p>
        <button type="button" className="btn btn-ghost mt-8" onClick={() => setStatus({ state: "idle" })}>
          Send another enquiry
        </button>
      </div>
    );
  }

  const fieldProps = (k: keyof Values) => ({
    id: `${uid}-${k}`,
    name: k,
    value: values[k],
    onChange: set(k),
    onBlur: blur(k),
    "aria-invalid": touched[k] && errors[k] ? true : undefined,
    "aria-describedby": touched[k] && errors[k] ? `${uid}-${k}-err` : undefined,
    className: "field",
  });

  const Err = ({ k }: { k: keyof Values }) =>
    touched[k] && errors[k] ? (
      <p id={`${uid}-${k}-err`} className="mt-2 text-sm text-[#ff9a8d]">
        {errors[k]}
      </p>
    ) : null;

  const Label = ({ k, children, optional }: { k: keyof Values; children: React.ReactNode; optional?: boolean }) => (
    <label htmlFor={`${uid}-${k}`} className="block font-mono text-[0.68rem] uppercase tracking-[0.16em] text-white/55">
      {children}
      {optional ? <span className="ml-1 normal-case tracking-normal text-white/50">(optional)</span> : <span aria-hidden> *</span>}
    </label>
  );

  return (
    <form onSubmit={onSubmit} noValidate aria-describedby={`${uid}-note`} className="grid gap-x-8 gap-y-9 sm:grid-cols-2">
      <div>
        <Label k="name">Your name</Label>
        <input {...fieldProps("name")} type="text" autoComplete="name" required placeholder="Full name" />
        <Err k="name" />
      </div>
      <div>
        <Label k="email">Email</Label>
        <input {...fieldProps("email")} type="email" autoComplete="email" required placeholder="you@company.com" inputMode="email" />
        <Err k="email" />
      </div>
      <div>
        <Label k="phone" optional>
          Phone
        </Label>
        <input {...fieldProps("phone")} type="tel" autoComplete="tel" placeholder="+91" inputMode="tel" />
        <Err k="phone" />
      </div>
      <div>
        <Label k="project">Project</Label>
        <input {...fieldProps("project")} type="text" required placeholder="e.g. Launch film for a new product" />
        <Err k="project" />
      </div>
      <div>
        <Label k="service">Service</Label>
        <select {...fieldProps("service")} required>
          <option value="" disabled>
            Select a service
          </option>
          {services.map((s) => (
            <option key={s.slug} value={s.title}>
              {s.title}
            </option>
          ))}
          <option value="Something else">Something else</option>
        </select>
        <Err k="service" />
      </div>
      <div>
        <Label k="budget" optional>
          Budget range
        </Label>
        <select {...fieldProps("budget")}>
          <option value="">Prefer not to say</option>
          {contact.budgets.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label k="message">Message</Label>
        <textarea
          {...fieldProps("message")}
          required
          rows={5}
          placeholder="Tell us about the idea, timeline, where it will be published and anything else that helps."
          className="field resize-y"
        />
        <Err k="message" />
      </div>

      {/* Honeypot — hidden from people, tempting for bots */}
      <div className="hidden" aria-hidden>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} />
        </label>
      </div>

      <div className="flex flex-col gap-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p id={`${uid}-note`} className="max-w-sm text-sm text-white/55">
          {hasBackend
            ? "Fields marked * are required."
            : "Fields marked * are required. Submitting opens your email app with your enquiry ready to send."}
        </p>
        <button type="submit" className="btn btn-light h-14 justify-center px-7" disabled={status.state === "sending"} data-cursor="hover">
          {status.state === "sending" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Sending…
            </>
          ) : (
            <>
              Send enquiry
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </button>
      </div>

      <div className="sm:col-span-2" aria-live="polite">
        {status.state === "mailto" && (
          <div className="border-l-2 border-white/50 pl-4 text-sm leading-relaxed text-white/70">
            Your email app should now be open with the enquiry filled in — <strong className="text-white">press send there</strong> to
            reach us. Nothing opened?{" "}
            <a href={status.href} className="underline underline-offset-4 hover:text-white">
              Try again
            </a>{" "}
            or write to{" "}
            <a href={`mailto:${site.email}`} className="underline underline-offset-4 hover:text-white">
              {site.email}
            </a>
            .
          </div>
        )}
        {status.state === "error" && (
          <div className="border-l-2 border-[#ff9a8d] pl-4 text-sm leading-relaxed text-white/75" role="alert">
            {status.message}{" "}
            <a href={status.href} className="underline underline-offset-4 hover:text-white">
              Send it by email instead
            </a>{" "}
            or write to {site.email}.
          </div>
        )}
      </div>
    </form>
  );
}
