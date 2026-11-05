"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { about } from "@/data/content";
import { MaskLines, Reveal } from "./Reveal";

function RotatingBadge() {
  const text = about.badge.repeat(2);
  return (
    <div className="relative h-32 w-32 sm:h-36 sm:w-36" aria-hidden>
      <svg viewBox="0 0 200 200" className="h-full w-full animate-spin-slow motion-reduce:animate-none">
        <defs>
          <path id="badge-circle" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
        </defs>
        <text className="fill-white font-mono text-[13px] uppercase tracking-[0.32em]">
          <textPath href="#badge-circle">{text}</textPath>
        </text>
      </svg>
      <span className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/30">
        <span className="h-2 w-2 animate-pulse-dot rounded-full bg-tungsten" />
      </span>
    </div>
  );
}

export function About() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y1 = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["6%", "-6%"]);
  const y2 = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["22%", "-18%"]);

  return (
    <section id="about" aria-labelledby="about-title" className="relative bg-black py-24 md:py-40">
      <div className="container-x grid gap-16 lg:grid-cols-12 lg:gap-10">
        {/* Text column */}
        <div className="lg:col-span-6 lg:pr-6">
          <Reveal>
            <p className="eyebrow flex items-center gap-3">
              <span className="text-white/90">(01)</span>
              <span className="h-px w-8 bg-white/30" aria-hidden />
              {about.eyebrow}
            </p>
          </Reveal>
          <h2 id="about-title" className="heading mt-6 text-[clamp(2.75rem,6.4vw,6rem)]">
            <MaskLines lines={["More than", "just production."]} />
          </h2>

          <Reveal delay={0.1}>
            <p className="mt-10 max-w-xl text-xl leading-snug text-white md:text-2xl">{about.lead}</p>
          </Reveal>
          <div className="mt-8 max-w-xl space-y-5 text-[1.02rem] leading-relaxed text-white/60">
            {about.body.map((p, i) => (
              <Reveal key={i} delay={0.15 + i * 0.08}>
                <p>{p}</p>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.25}>
            <ul className="mt-12 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/10 pt-6 font-mono text-xs uppercase tracking-[0.18em] text-white/70">
              {about.pillars.map((p, i) => (
                <li key={p} className="flex items-center gap-3">
                  <span className="text-white/50">0{i + 1}</span>
                  {p}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        {/* Image column */}
        <div ref={ref} className="relative lg:col-span-6">
          <div className="relative ml-auto w-[82%] sm:w-[70%] lg:w-[78%]">
            <motion.div style={{ y: y1 }} className="grain relative aspect-[4/5] overflow-hidden bg-char">
              <Image
                src={about.images.primary.src}
                alt={about.images.primary.alt}
                fill
                sizes="(min-width: 1024px) 38vw, 80vw"
                className="object-cover transition-transform duration-[1.6s] ease-[var(--ease-cine)] hover:scale-105"
              />
            </motion.div>
          </div>
          <motion.div
            style={{ y: y2 }}
            className="grain absolute -bottom-10 left-0 w-[52%] overflow-hidden border-[6px] border-black bg-char sm:w-[44%] lg:-left-4"
          >
            <div className="relative aspect-[4/3]">
              <Image
                src={about.images.secondary.src}
                alt={about.images.secondary.alt}
                fill
                sizes="(min-width: 1024px) 24vw, 50vw"
                className="object-cover"
              />
            </div>
          </motion.div>
          <div className="absolute -top-8 left-[6%] hidden sm:block">
            <RotatingBadge />
          </div>
        </div>
      </div>
    </section>
  );
}
