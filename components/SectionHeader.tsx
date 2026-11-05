import { MaskLines, Reveal } from "./Reveal";

/** Consistent "(01) — Label" + large heading used to open each section. */
export function SectionHeader({
  index,
  eyebrow,
  title,
  aside,
  id,
}: {
  index: string;
  eyebrow: string;
  title: React.ReactNode[];
  aside?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="grid gap-8 md:grid-cols-12 md:items-end">
      <div className="md:col-span-8">
        <Reveal>
          <p className="eyebrow flex items-center gap-3">
            <span className="text-white/90">({index})</span>
            <span className="h-px w-8 bg-white/30" aria-hidden />
            {eyebrow}
          </p>
        </Reveal>
        <h2 id={id} className="heading mt-6 text-[clamp(2.5rem,6.6vw,6.25rem)]">
          <MaskLines lines={title} />
        </h2>
      </div>
      {aside ? (
        <Reveal delay={0.15} className="md:col-span-4 md:pb-3">
          {aside}
        </Reveal>
      ) : null}
    </div>
  );
}
