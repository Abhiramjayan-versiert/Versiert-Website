"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { showTestimonials, testimonials } from "@/data/testimonials";
import { Reveal } from "./Reveal";

export function Testimonials() {
  const [i, setI] = useState(0);
  if (!showTestimonials || testimonials.length === 0) return null;

  const t = testimonials[i];
  const go = (d: number) => setI((v) => (v + d + testimonials.length) % testimonials.length);
  const anySample = testimonials.some((x) => x.isSample);

  return (
    <section aria-labelledby="testimonials-title" className="relative bg-char py-24 md:py-36">
      <div className="container-x grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Reveal>
            <p className="eyebrow flex items-center gap-3">
              <span className="text-white/90">(06)</span>
              <span className="h-px w-8 bg-white/30" aria-hidden />
              Client words
            </p>
            <h2 id="testimonials-title" className="heading mt-6 text-[clamp(2.25rem,4vw,3.5rem)]">
              In their words.
            </h2>
            {anySample && (
              <p className="mt-6 max-w-xs border-l border-tungsten/60 pl-4 text-sm leading-relaxed text-white/55">
                Sample content — these are placeholders, not real client reviews. Genuine testimonials will be added
                with permission.
              </p>
            )}
          </Reveal>
        </div>

        <div className="lg:col-span-8">
          <figure className="relative min-h-[18rem]" aria-live="polite">
            <span aria-hidden className="pointer-events-none absolute -top-6 right-0 select-none text-[8rem] leading-none text-white/[0.07] md:-top-16 md:text-[13rem]">
              “
            </span>
            <AnimatePresence mode="wait">
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                {t.isSample && (
                  <span className="mb-6 inline-block border border-tungsten/60 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-tungsten">
                    Sample testimonial
                  </span>
                )}
                <blockquote className="text-[clamp(1.5rem,3vw,2.6rem)] font-medium leading-[1.15] tracking-[-0.025em]">
                  {t.quote}
                </blockquote>
                <figcaption className="mt-8 text-white/60">
                  <span className="text-white">{t.name}</span>
                  {t.role ? ` — ${t.role}` : ""}
                </figcaption>
              </motion.div>
            </AnimatePresence>
          </figure>

          {testimonials.length > 1 && (
            <div className="mt-10 flex items-center gap-3">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous testimonial"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 transition-colors hover:bg-white hover:text-black"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next testimonial"
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 transition-colors hover:bg-white hover:text-black"
              >
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
              <span className="ml-3 font-mono text-xs tracking-[0.2em] text-white/55">
                {String(i + 1).padStart(2, "0")} / {String(testimonials.length).padStart(2, "0")}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
