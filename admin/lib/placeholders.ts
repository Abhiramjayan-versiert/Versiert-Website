/** Finds everything on the site that is still a placeholder or unset. */
export type Todo = { section: string; label: string; kind: "placeholder" | "missing" | "optional" };

const GENERATED = /^\/images\/(hero\/hero|about\/about-[12]|services\/[a-z-]+|work\/sample-\d\d|contact\/contact)\.webp$/;
const isGenerated = (p: unknown) => typeof p === "string" && GENERATED.test(p);

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function findTodos(c: { site: Any; home: Any; services: Any; projects: Any; testimonials: Any }): Todo[] {
  const t: Todo[] = [];
  const img = (section: string, label: string, p: unknown) => {
    if (!p) t.push({ section, label: `${label}: no image set`, kind: "missing" });
    else if (isGenerated(p)) t.push({ section, label: `${label}: placeholder image`, kind: "placeholder" });
  };

  img("hero", "Hero background", c.home.hero?.image);
  if (!c.home.hero?.video?.mp4 && !c.home.hero?.video?.webm)
    t.push({ section: "hero", label: "Hero showreel video (optional)", kind: "optional" });
  img("about", "About large image", c.home.about?.images?.primary?.src);
  img("about", "About small image", c.home.about?.images?.secondary?.src);
  img("contact", "Contact backdrop", c.home.contact?.backdrop);

  for (const s of c.services.items || []) img("services", `Service “${s.title}”`, s.image);

  for (const p of c.projects.items || []) {
    if (p.isSample) t.push({ section: "work", label: `Sample project “${p.title}”`, kind: "placeholder" });
    else {
      img("work", `Project “${p.title}”`, p.thumbnail);
      if (!p.videoUrl) t.push({ section: "work", label: `Project “${p.title}”: no video link`, kind: "optional" });
    }
  }

  if (c.testimonials.show)
    for (const q of c.testimonials.items || [])
      if (q.isSample) t.push({ section: "testimonials", label: `Sample testimonial (${q.name || "unnamed"})`, kind: "placeholder" });

  for (const s of c.site.socials || [])
    if (!String(s.href || "").trim()) t.push({ section: "settings", label: `${s.label} link not set`, kind: "missing" });
  if (!c.site.form?.web3formsKey && !c.site.form?.endpoint)
    t.push({ section: "settings", label: "Contact form uses the email-app fallback (add a Web3Forms key)", kind: "optional" });

  return t;
}
