"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Play } from "lucide-react";
import { categories, projects, type Category, type Project } from "@/data/projects";
import { Reveal } from "./Reveal";
import { SectionHeader } from "./SectionHeader";
import { ProjectModal } from "./ProjectModal";

type Filter = "All" | Category;

function ProjectCard({ project, index, onOpen }: { project: Project; index: number; onOpen: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const play = () => {
    const v = videoRef.current;
    if (v) v.play().catch(() => {});
  };
  const stop = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  };

  return (
    <Reveal y={40}>
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={(e) => e.pointerType === "mouse" && play()}
        onPointerLeave={stop}
        onFocus={play}
        onBlur={stop}
        className="group block w-full text-left"
        aria-label={`View project: ${project.title} (${project.category})`}
        data-cursor="view"
      >
        <div
          className={`grain relative w-full overflow-hidden bg-char ${project.layout === "tall" ? "aspect-[4/5]" : "aspect-[16/11]"}`}
        >
          <Image
            src={project.thumbnail}
            alt=""
            fill
            sizes="(min-width: 768px) 46vw, 100vw"
            className="object-cover transition-transform duration-[1.4s] ease-[var(--ease-cine)] group-hover:scale-[1.06]"
          />
          {project.previewVideo && (
            <video
              ref={videoRef}
              src={project.previewVideo}
              muted
              loop
              playsInline
              preload="none"
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-700 group-hover:opacity-100"
            />
          )}
          <div className="absolute inset-0 bg-black/10 transition-colors duration-700 group-hover:bg-black/30" />

          {project.isSample && (
            <span className="absolute left-4 top-4 z-10 border border-white/30 bg-black/50 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-white/85 backdrop-blur-sm">
              Sample
            </span>
          )}

          <span className="absolute right-4 top-4 z-10 font-mono text-[0.65rem] tracking-[0.2em] text-white/70">
            {String(index + 1).padStart(2, "0")}
          </span>

          {/* View affordance */}
          <span className="absolute inset-0 z-10 flex items-center justify-center">
            <span className="flex h-24 w-24 scale-75 items-center justify-center gap-1.5 rounded-full bg-white text-sm font-medium text-black opacity-0 transition-all duration-500 ease-[var(--ease-cine)] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
              {project.videoUrl ? <Play className="h-3.5 w-3.5 fill-black" aria-hidden /> : null}
              View
            </span>
          </span>
        </div>

        <div className="mt-5 flex items-start justify-between gap-6">
          <div>
            <h3 className="text-xl font-medium tracking-[-0.02em] md:text-2xl">{project.title}</h3>
            <p className="mt-1.5 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-white/50">{project.category}</p>
          </div>
          <span className="mt-1 flex shrink-0 items-center gap-1.5 text-sm text-white/60 transition-colors group-hover:text-white">
            View Project
            <ArrowUpRight className="h-4 w-4 transition-transform duration-500 group-hover:rotate-45" aria-hidden />
          </span>
        </div>
      </button>
    </Reveal>
  );
}

export function Work() {
  const [filter, setFilter] = useState<Filter>("All");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const list = useMemo(() => (filter === "All" ? projects : projects.filter((p) => p.category === filter)), [filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: projects.length };
    categories.forEach((k) => (c[k] = projects.filter((p) => p.category === k).length));
    return c;
  }, []);

  // Balance the two editorial columns by estimated tile height
  const [left, right] = useMemo(() => {
    const cols: [Project[], Project[]] = [[], []];
    const h = [0, 0.45]; // right column starts offset
    list.forEach((p) => {
      const c = h[0] <= h[1] ? 0 : 1;
      cols[c].push(p);
      h[c] += (p.layout === "tall" ? 1.25 : 0.69) + 0.35;
    });
    return cols;
  }, [list]);

  const close = useCallback(() => setOpenIndex(null), []);
  const next = useCallback(() => setOpenIndex((i) => (i === null ? i : (i + 1) % list.length)), [list.length]);
  const prev = useCallback(() => setOpenIndex((i) => (i === null ? i : (i - 1 + list.length) % list.length)), [list.length]);

  const filters: Filter[] = ["All", ...categories];
  const hasSamples = projects.some((p) => p.isSample);

  return (
    <section id="work" aria-labelledby="work-title" className="relative bg-black py-24 md:py-40">
      <div className="container-x">
        <SectionHeader
          index="03"
          eyebrow="Our Work"
          id="work-title"
          title={["Selected", "work."]}
          aside={
            <p className="max-w-sm text-white/60">
              Films, campaigns, content and stills — produced end-to-end.
              {hasSamples && (
                <span className="mt-3 block font-mono text-[0.7rem] uppercase tracking-[0.16em] text-tungsten/90">
                  Portfolio launching soon — tiles marked “Sample” are placeholders.
                </span>
              )}
            </p>
          }
        />

        <Reveal delay={0.1}>
          <div className="-mx-[clamp(1.25rem,4vw,3.5rem)] mt-14 overflow-x-auto px-[clamp(1.25rem,4vw,3.5rem)] [scrollbar-width:none] md:mx-0 md:px-0">
            <ul className="flex w-max gap-2 md:w-auto md:flex-wrap" aria-label="Filter projects by category">
              {filters.map((f) => {
                const active = filter === f;
                return (
                  <li key={f}>
                    <button
                      type="button"
                      onClick={() => setFilter(f)}
                      aria-pressed={active}
                      className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-colors duration-300 ${
                        active ? "border-white bg-white text-black" : "border-white/20 text-white/70 hover:border-white/60 hover:text-white"
                      }`}
                    >
                      {f}
                      <sup className={`font-mono text-[0.6rem] ${active ? "text-black/50" : "text-white/50"}`}>{counts[f]}</sup>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Reveal>

        <AnimatePresence mode="wait">
          <motion.div
            key={filter}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-12 md:mt-16"
          >
            {list.length === 0 ? (
              <p className="border-y border-white/10 py-20 text-center text-white/50">New work in this category is on its way.</p>
            ) : (
              <>
                {/* Mobile: single column */}
                <div className="grid gap-14 md:hidden">
                  {list.map((p, i) => (
                    <ProjectCard key={p.id} project={p} index={i} onOpen={() => setOpenIndex(i)} />
                  ))}
                </div>
                {/* Desktop: staggered editorial columns */}
                <div className="hidden gap-[clamp(1.5rem,4vw,5rem)] md:grid md:grid-cols-2">
                  <div className="flex flex-col gap-[clamp(3rem,7vw,7rem)]">
                    {left.map((p) => {
                      const i = list.indexOf(p);
                      return <ProjectCard key={p.id} project={p} index={i} onOpen={() => setOpenIndex(i)} />;
                    })}
                  </div>
                  <div className="flex flex-col gap-[clamp(3rem,7vw,7rem)] md:pt-[clamp(5rem,10vw,10rem)]">
                    {right.map((p) => {
                      const i = list.indexOf(p);
                      return <ProjectCard key={p.id} project={p} index={i} onOpen={() => setOpenIndex(i)} />;
                    })}
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {openIndex !== null && list[openIndex] && (
          <ProjectModal
            project={list[openIndex]}
            index={openIndex}
            total={list.length}
            onClose={close}
            onNext={next}
            onPrev={prev}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
