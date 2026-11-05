"use client";

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { process } from "@/data/content";
import { Reveal } from "./Reveal";
import { SectionHeader } from "./SectionHeader";

export function Process() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.55"] });
  const fill = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0, 1]);
  const [reached, setReached] = useState(reduce ? process.steps.length : 0);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (reduce) return;
    const n = process.steps.length;
    setReached(Math.min(n, Math.floor(v * n + 0.35)));
  });

  return (
    <section aria-labelledby="process-title" className="relative overflow-hidden bg-char py-24 md:py-40">
      <div className="container-x">
        <SectionHeader index="04" eyebrow={process.eyebrow} id="process-title" title={["From first idea", "to final frame."]} />

        <div ref={ref} className="relative mt-16 md:mt-28">
          {/* Desktop horizontal rail */}
          <div className="absolute left-0 right-0 top-[7px] hidden h-px bg-white/15 lg:block" aria-hidden>
            <motion.div className="h-full origin-left bg-white" style={{ scaleX: fill }} />
          </div>
          {/* Mobile vertical rail */}
          <div className="absolute bottom-0 left-[7px] top-2 w-px bg-white/15 lg:hidden" aria-hidden>
            <motion.div className="h-full w-full origin-top bg-white" style={{ scaleY: fill }} />
          </div>

          <ol className="grid gap-14 lg:grid-cols-4 lg:gap-10">
            {process.steps.map((s, i) => {
              const on = i < reached;
              return (
                <li key={s.no} className="relative pl-12 lg:pl-0 lg:pt-16">
                  <span
                    aria-hidden
                    className={`absolute left-0 top-1 h-[15px] w-[15px] rounded-full border transition-all duration-700 lg:top-0 ${
                      on ? "border-white bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.08)]" : "border-white/40 bg-char"
                    }`}
                  />
                  <Reveal delay={i * 0.08}>
                    <span
                      className={`block font-mono text-sm tracking-[0.2em] transition-colors duration-700 ${on ? "text-white" : "text-white/50"}`}
                    >
                      {s.no} —
                    </span>
                    <h3 className="mt-4 text-[clamp(2rem,3vw,2.75rem)] font-medium leading-none tracking-[-0.035em]">{s.title}</h3>
                    <p className="mt-5 max-w-xs leading-relaxed text-white/60">{s.text}</p>
                  </Reveal>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
