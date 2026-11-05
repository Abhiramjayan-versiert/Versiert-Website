"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

/**
 * Subtle desktop-only cursor follower. The native cursor stays visible
 * (accessibility); this ring grows over interactive elements and shows
 * "View" over portfolio tiles. Disabled on touch and reduced-motion.
 */
export function Cursor() {
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<"default" | "hover" | "view">("default");
  const [visible, setVisible] = useState(false);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 500, damping: 40, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 500, damping: 40, mass: 0.4 });

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;
    setEnabled(true);

    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      setVisible(true);
      const t = (e.target as HTMLElement)?.closest?.("[data-cursor], a, button, select, label") as HTMLElement | null;
      const m = t?.dataset.cursor === "view" ? "view" : t ? "hover" : "default";
      setMode(m);
    };
    const leave = () => setVisible(false);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [x, y]);

  if (!enabled) return null;

  const size = mode === "view" ? 88 : mode === "hover" ? 44 : 10;

  return (
    <motion.div
      aria-hidden
      className="cursor-dot pointer-events-none fixed border-solid border-white left-0 top-0 z-[90] flex items-center justify-center rounded-full mix-blend-difference"
      style={{ x: sx, y: sy, translateX: "-50%", translateY: "-50%" }}
      animate={{
        width: size,
        height: size,
        opacity: visible ? 1 : 0,
        backgroundColor: mode === "default" ? "rgba(255,255,255,1)" : mode === "view" ? "rgba(255,255,255,1)" : "rgba(255,255,255,0)",
        borderWidth: mode === "hover" ? 1 : 0,
      }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <span
        className={`text-[0.7rem] font-medium uppercase tracking-[0.14em] text-black transition-opacity duration-200 ${mode === "view" ? "opacity-100" : "opacity-0"}`}
      >
        View
      </span>
    </motion.div>
  );
}
