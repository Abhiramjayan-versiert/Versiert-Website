import { site } from "@/lib/site";

export function Wordmark({ className = "", stacked = true }: { className?: string; stacked?: boolean }) {
  return (
    <span className={`inline-flex select-none leading-none ${stacked ? "flex-col" : "items-baseline gap-2"} ${className}`}>
      <span className="text-[1.15rem] font-semibold tracking-[-0.04em] sm:text-[1.3rem]">{site.wordmark}</span>{" "}
      <span
        className={`font-mono text-[0.52rem] tracking-[0.62em] text-white/70 ${stacked ? "mt-[3px]" : ""}`}
      >
        {site.wordmarkSub}
      </span>
    </span>
  );
}
