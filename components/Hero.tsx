"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { hero } from "@/data/content";
import { site } from "@/lib/site";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Decorative running SMPTE-style timecode (25fps). */
function Timecode() {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const start = performance.now();
    const pad = (n: number) => String(n).padStart(2, "0");
    const id = window.setInterval(() => {
      const t = (performance.now() - start) / 1000;
      const f = Math.floor((t % 1) * 25);
      const s = Math.floor(t) % 60;
      const m = Math.floor(t / 60) % 60;
      const h = Math.floor(t / 3600);
      if (ref.current) ref.current.textContent = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
    }, 40);
    return () => window.clearInterval(id);
  }, [reduce]);
  return (
    <span ref={ref} className="tabular-nums">
      00:00:00:00
    </span>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [useVideo, setUseVideo] = useState(false);

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "18%"]);
  const bgScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.08]);
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "-12%"]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  // Only load the background video if one is configured and the visitor
  // hasn't asked for reduced motion / reduced data.
  useEffect(() => {
    if (!hero.video.mp4 && !hero.video.webm) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (reduce || conn?.saveData) return;
    setUseVideo(true);
  }, [reduce]);

  return (
    <section
      id="top"
      ref={ref}
      aria-labelledby="hero-title"
      className="grain relative isolate flex min-h-[100svh] min-h-[640px] flex-col overflow-hidden bg-black"
    >
      {/* Background */}
      <motion.div className="absolute inset-0 -z-10" style={{ y: bgY, scale: bgScale }} aria-hidden>
        <div className="hero-bg absolute inset-0">
          <Image src={hero.image} alt="" fill priority sizes="100vw" className="object-cover opacity-80" />
          {useVideo && (
            <video
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={hero.image}
            >
              {hero.video.webm && <source src={hero.video.webm} type="video/webm" />}
              {hero.video.mp4 && <source src={hero.video.mp4} type="video/mp4" />}
            </video>
          )}
        </div>
        {/* Cinematic grading overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]" />
      </motion.div>

      {/* Viewfinder frame */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-[clamp(1.25rem,4vw,3.5rem)] bottom-6 top-24 hidden md:block"
        initial={reduce ? false : { opacity: 0, scale: 1.03 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, delay: 0.6, ease: EASE }}
      >
        <span className="vf-corner left-0 top-0 border-l border-t" />
        <span className="vf-corner right-0 top-0 border-r border-t" />
        <span className="vf-corner bottom-0 left-0 border-b border-l" />
        <span className="vf-corner bottom-0 right-0 border-b border-r" />
        <div className="absolute right-6 top-4 flex items-center gap-3 font-mono text-[0.68rem] tracking-[0.2em] text-white/70">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-tungsten" />
            REC
          </span>
          <Timecode />
        </div>
        <div className="absolute left-6 top-4 font-mono text-[0.68rem] tracking-[0.2em] text-white/50">
          4K · 25 FPS · 2.39:1
        </div>
      </motion.div>

      {/* Content */}
      <motion.div style={{ y: contentY, opacity: fade }} className="container-x relative flex flex-1 flex-col justify-end pb-10 pt-32 md:pb-20">
        <h1 id="hero-title" className="display text-[clamp(3.6rem,min(19vw,21svh),15rem)]">
          <span className="sr-only">{hero.headline.join(" ")}</span>
          <span aria-hidden>
            {hero.headline.map((line, i) => (
              <span key={i} className="-mb-[0.06em] block overflow-hidden pb-[0.06em]">
                <span
                  className={`hero-rise block ${i === 1 ? "md:pl-[0.9em]" : ""}`}
                  style={{ "--d": `${0.15 + i * 0.1}s` } as React.CSSProperties}
                >
                  {line}
                </span>
              </span>
            ))}
          </span>
        </h1>

        <div className="mt-10 grid gap-8 md:mt-14 md:grid-cols-12 md:items-end">
          <p
            className="hero-fade max-w-md text-[1.05rem] leading-relaxed text-white/75 md:col-span-5 md:col-start-1 md:text-lg"
            style={{ "--d": "0.45s" } as React.CSSProperties}
          >
            {hero.supporting}
          </p>

          <div
            className="hero-fade flex flex-wrap gap-3 md:col-span-7 md:justify-end"
            style={{ "--d": "0.6s" } as React.CSSProperties}
          >
            <a href={hero.primaryCta.href} className="btn btn-light" data-cursor="hover">
              {hero.primaryCta.label}
              <ArrowDown className="h-4 w-4" aria-hidden />
            </a>
            <a href={hero.secondaryCta.href} className="btn btn-ghost" data-cursor="hover">
              {hero.secondaryCta.label}
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>

        <div
          className="hero-fade mt-12 flex items-center justify-between border-t border-white/15 pt-5 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-white/60"
          style={{ "--d": "0.75s" } as React.CSSProperties}
        >
          <p className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-white" aria-hidden />
            Based in {site.location.short}
            <span className="hidden text-white/50 sm:inline">— {site.location.coords}</span>
          </p>
          <a href="#about" className="hidden items-center gap-2 hover:text-white sm:flex">
            Scroll
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </motion.div>
    </section>
  );
}
