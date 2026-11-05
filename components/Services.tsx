"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { services } from "@/data/services";
import { enquire } from "@/lib/enquire";
import { Reveal } from "./Reveal";
import { SectionHeader } from "./SectionHeader";

export function Services() {
  const listRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const reduce = useReducedMotion();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 28, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 220, damping: 28, mass: 0.6 });

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !listRef.current) return;
    const r = listRef.current.getBoundingClientRect();
    x.set(e.clientX - r.left);
    y.set(e.clientY - r.top);
  };

  return (
    <section id="services" aria-labelledby="services-title" className="relative bg-char py-24 md:py-40">
      <div className="container-x">
        <SectionHeader
          index="02"
          eyebrow="Services"
          id="services-title"
          title={["What we", "create."]}
          aside={
            <p className="max-w-sm text-white/60">
              Eight disciplines, one production team. Engage us for a single shoot or an entire content programme.
            </p>
          }
        />

        <div
          ref={listRef}
          className="relative mt-16 md:mt-24"
          onPointerMove={onMove}
          onPointerLeave={() => setHovered(null)}
        >
          {/* Floating preview (desktop, mouse only) */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-0 hidden h-[22rem] w-[17.5rem] lg:block"
            style={{ x: sx, y: sy, translateX: "-50%", translateY: "-50%" }}
            animate={{ opacity: hovered === null ? 0 : 1, scale: hovered === null ? 0.85 : 1 }}
            transition={{ duration: reduce ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="grain relative h-full w-full overflow-hidden bg-black">
              {services.map((s, i) => (
                <Image
                  key={s.slug}
                  src={s.image}
                  alt=""
                  fill
                  sizes="280px"
                  className={`object-cover transition-[opacity,transform] duration-700 ease-[var(--ease-cine)] ${
                    hovered === i ? "scale-100 opacity-100" : "scale-110 opacity-0"
                  }`}
                />
              ))}
              <span className="absolute bottom-3 left-3 z-10 font-mono text-[0.65rem] tracking-[0.2em] text-white/80">
                {hovered !== null ? `0${hovered + 1} / 0${services.length}` : ""}
              </span>
            </div>
          </motion.div>

          <ul className="relative z-10 border-t border-white/12">
            {services.map((s, i) => (
              <li key={s.slug} onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(i)}>
                <Reveal delay={Math.min(i * 0.04, 0.2)} y={20}>
                  <article
                    className={`group relative grid gap-5 border-b border-white/12 py-8 transition-colors duration-500 md:grid-cols-12 md:items-center md:gap-6 md:py-10 ${
                      hovered !== null && hovered !== i ? "lg:text-white/50" : ""
                    }`}
                  >
                    {/* Mobile visual */}
                    <div className="grain relative aspect-[16/9] overflow-hidden bg-black lg:hidden">
                      <Image src={s.image} alt={s.alt} fill sizes="(min-width: 768px) 90vw, 100vw" className="object-cover" />
                    </div>

                    <span className="font-mono text-xs tracking-[0.2em] text-white/50 md:col-span-1">0{i + 1}</span>
                    <h3 className="text-[clamp(1.9rem,3.6vw,3.4rem)] font-medium leading-[1] tracking-[-0.035em] transition-transform duration-700 ease-[var(--ease-cine)] md:col-span-5 lg:group-hover:translate-x-4">
                      {s.title}
                    </h3>
                    <div className="md:col-span-4">
                      <p className="text-[0.98rem] leading-relaxed text-white/60 transition-colors duration-500 lg:group-hover:text-white/80">
                        {s.description}
                      </p>
                      <ul className="mt-4 flex flex-wrap gap-2" aria-label={`${s.title} includes`}>
                        {s.tags.map((t) => (
                          <li key={t} className="border border-white/15 px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-white/55">
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="md:col-span-2 md:text-right">
                      <button
                        type="button"
                        onClick={() => enquire(s.title)}
                        className="group/btn inline-flex items-center gap-2 text-sm font-medium text-white"
                        aria-label={`Enquire about ${s.title}`}
                        data-cursor="hover"
                      >
                        <span className="link-line">Enquire</span>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 transition-all duration-500 group-hover/btn:rotate-45 group-hover/btn:border-white group-hover/btn:bg-white group-hover/btn:text-black">
                          <ArrowUpRight className="h-4 w-4" aria-hidden />
                        </span>
                      </button>
                    </div>
                  </article>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
