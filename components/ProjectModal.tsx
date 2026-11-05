"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { Project } from "@/data/projects";
import { parseVideoUrl } from "@/lib/video";
import { enquire } from "@/lib/enquire";

type Props = {
  project: Project;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export function ProjectModal({ project, index, total, onClose, onPrev, onNext }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const video = parseVideoUrl(project.videoUrl);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "ArrowLeft") onPrev();
      // Basic focus trap
      if (e.key === "Tab" && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), iframe, video, [tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose, onNext, onPrev]);

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-title"
      className="fixed inset-0 z-[70] overflow-y-auto bg-black/95 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="container-x flex min-h-full flex-col py-6 md:py-10" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs tracking-[0.2em] text-white/50">
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 transition-colors hover:bg-white hover:text-black"
            aria-label="Close project"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <motion.div
          key={project.id}
          className="mt-6 grid flex-1 gap-8 lg:grid-cols-12 lg:items-center"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="lg:col-span-8">
            <div className="relative aspect-video w-full overflow-hidden bg-char">
              {video?.kind === "youtube" || video?.kind === "vimeo" ? (
                <iframe
                  src={video.embed}
                  title={project.title}
                  className="absolute inset-0 h-full w-full"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  allowFullScreen
                />
              ) : video?.kind === "file" ? (
                <video src={video.src} poster={project.thumbnail} controls autoPlay playsInline className="absolute inset-0 h-full w-full bg-black object-contain" />
              ) : (
                <>
                  <Image src={project.thumbnail} alt={project.title} fill sizes="(min-width:1024px) 66vw, 100vw" className="object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5">
                    <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-white/70">
                      {project.isSample ? "Sample still — video link to be added" : "Still frame"}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="lg:col-span-4">
            {project.isSample && (
              <span className="inline-block border border-tungsten/60 px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-tungsten">
                Sample placeholder
              </span>
            )}
            <p className="eyebrow mt-5">
              {project.category}
              {project.year ? ` · ${project.year}` : ""}
            </p>
            <h3 id="project-title" className="heading mt-3 text-[clamp(2rem,4vw,3.5rem)]">
              {project.title}
            </h3>
            {project.client && <p className="mt-3 text-white/60">Client — {project.client}</p>}
            <p className="mt-6 leading-relaxed text-white/70">{project.description}</p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-light"
                onClick={() => {
                  onClose();
                  setTimeout(() => enquire(), 50);
                }}
              >
                Start a similar project
              </button>
            </div>

            <div className="mt-10 flex items-center gap-3 border-t border-white/10 pt-6">
              <button
                type="button"
                onClick={onPrev}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 transition-colors hover:bg-white hover:text-black"
                aria-label="Previous project"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onNext}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 transition-colors hover:bg-white hover:text-black"
                aria-label="Next project"
              >
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
              <span className="ml-2 text-sm text-white/50">Use ← → keys</span>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
