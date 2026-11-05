import { marquee } from "@/data/content";

export function Marquee() {
  const items = [...marquee, ...marquee];
  return (
    <div className="relative overflow-hidden border-y border-white/10 bg-black py-6" aria-hidden>
      <div className="flex w-max animate-marquee items-center motion-reduce:animate-none">
        {items.map((t, i) => (
          <span key={i} className="flex items-center whitespace-nowrap text-[clamp(1.25rem,2.6vw,2.25rem)] font-medium tracking-[-0.03em]">
            <span className={i % 2 ? "text-white/50" : "text-white"}>{t}</span>
            <span className="mx-8 inline-block h-[0.45em] w-[0.45em] rotate-45 border border-white/40" />
          </span>
        ))}
      </div>
    </div>
  );
}
