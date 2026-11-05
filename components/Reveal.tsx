"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

type Props = HTMLMotionProps<"div"> & { delay?: number; y?: number; as?: "div" | "li" | "p" | "span" };

/** Fades + lifts content in once when it scrolls into view. */
export function Reveal({ delay = 0, y = 28, children, as = "div", ...rest }: Props) {
  const reduce = useReducedMotion();
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/** Masked line-by-line title reveal (text slides up from behind a mask). */
export function MaskLines({
  lines,
  className = "",
  lineClassName = "",
  delay = 0,
  stagger = 0.09,
  animateOnMount = false,
}: {
  lines: React.ReactNode[];
  className?: string;
  lineClassName?: string;
  delay?: number;
  stagger?: number;
  animateOnMount?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <span className={className}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.06em] -mb-[0.06em]">
          <motion.span
            className={`block will-change-transform ${lineClassName}`}
            initial={reduce ? false : { y: "105%" }}
            {...(animateOnMount
              ? { animate: { y: "0%" } }
              : { whileInView: { y: "0%" }, viewport: { once: true, margin: "0px 0px -8% 0px" } })}
            transition={{ duration: 1.1, delay: delay + i * stagger, ease: [0.22, 1, 0.36, 1] }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
