"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { navigation, ctaLabel } from "@/data/navigation";
import { site, activeSocials } from "@/lib/site";
import { Wordmark } from "./Wordmark";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("#top");
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Solid background after leaving the hero
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Track which section is in view for the active nav state
  useEffect(() => {
    const ids = navigation.map((n) => n.href.slice(1));
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(`#${e.target.id}`);
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Mobile menu: lock scroll + Esc to close
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close the menu if resized up to desktop
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-500 ${
        open
          ? "border-b border-transparent bg-black"
          : scrolled
            ? "border-b border-white/10 bg-black/75 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="container-x relative z-10 flex h-[4.5rem] items-center justify-between">
        <a href="#top" title={`${site.name} — home`} className="relative z-10" onClick={() => setOpen(false)}>
          <Wordmark />
        </a>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {navigation.map((item) => {
              const isActive = active === item.href;
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={isActive ? "true" : undefined}
                    className={`group relative rounded-full px-4 py-2 text-[0.85rem] transition-colors duration-300 ${
                      isActive ? "text-white" : "text-white/60 hover:text-white"
                    }`}
                  >
                    {item.label}
                    <span
                      className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white transition-opacity duration-300 ${
                        isActive ? "opacity-100" : "opacity-0"
                      }`}
                      aria-hidden
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <a href="#contact" className="btn btn-light hidden h-11 sm:inline-flex" data-cursor="hover">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-black" />
            </span>
            {ctaLabel}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>

          <button
            ref={toggleRef}
            type="button"
            className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="relative block h-3 w-5" aria-hidden>
              <span
                className={`absolute left-0 block h-px w-5 bg-white transition-all duration-500 ease-[var(--ease-cine)] ${
                  open ? "top-1.5 rotate-45" : "top-0"
                }`}
              />
              <span
                className={`absolute left-0 block h-px bg-white transition-all duration-500 ease-[var(--ease-cine)] ${
                  open ? "top-1.5 w-5 -rotate-45" : "top-3 w-3"
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-0 top-0 -z-0 flex h-[100svh] flex-col bg-black lg:hidden"
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }}
          >
            <nav aria-label="Mobile" className="container-x flex flex-1 flex-col justify-center pt-20">
              <ul className="space-y-1">
                {navigation.map((item, i) => (
                  <li key={item.href} className="overflow-hidden">
                    <motion.a
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-baseline gap-4 py-1 text-[clamp(2.6rem,11vw,4.5rem)] font-medium leading-[1.05] tracking-[-0.04em]"
                      initial={{ y: "110%" }}
                      animate={{ y: "0%" }}
                      exit={{ y: "110%" }}
                      transition={{ duration: 0.7, delay: 0.15 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <span className="font-mono text-xs tracking-widest text-white/50">0{i + 1}</span>
                      {item.label}
                    </motion.a>
                  </li>
                ))}
              </ul>
            </nav>
            <motion.div
              className="container-x flex flex-col gap-4 border-t border-white/10 py-8 text-sm text-white/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.5 } }}
              exit={{ opacity: 0 }}
            >
              <a href={`mailto:${site.email}`} className="text-lg text-white">
                {site.email}
              </a>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <span>{site.location.short}</span>
                {activeSocials.length > 0 && (
                  <ul className="flex gap-4">
                    {activeSocials.map((s) => (
                      <li key={s.label}>
                        <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <a href="#contact" onClick={() => setOpen(false)} className="btn btn-light mt-2 w-full justify-center sm:hidden">
                {ctaLabel}
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
