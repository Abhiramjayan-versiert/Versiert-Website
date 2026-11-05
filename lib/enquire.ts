export const ENQUIRE_EVENT = "versiert:enquire";

/** Pre-selects a service in the contact form and scrolls to it. */
export function enquire(service?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string | undefined>(ENQUIRE_EVENT, { detail: service }));
  const el = document.getElementById("contact");
  if (el) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
}
