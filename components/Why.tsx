import { why } from "@/data/content";
import { Reveal } from "./Reveal";
import { SectionHeader } from "./SectionHeader";

export function Why() {
  return (
    <section aria-labelledby="why-title" className="relative bg-black py-24 md:py-40">
      <div className="container-x">
        <SectionHeader
          index="05"
          eyebrow={why.eyebrow}
          id="why-title"
          title={["Made with intent.", "Built around", "your objective."]}
        />

        <ol className="mt-16 md:mt-24">
          {why.points.map((p, i) => (
            <li key={p.title} className="border-t border-white/12 last:border-b">
              <Reveal y={24}>
                <div className="group grid gap-4 py-8 md:grid-cols-12 md:items-baseline md:gap-6 md:py-12">
                  <span className="font-mono text-xs tracking-[0.2em] text-white/50 md:col-span-2">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[clamp(1.75rem,4.2vw,4rem)] font-medium leading-[1] tracking-[-0.04em] text-white/90 transition-colors duration-500 group-hover:text-white md:col-span-6">
                    {p.title}
                  </h3>
                  <p className="max-w-md leading-relaxed text-white/55 md:col-span-4">{p.text}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
