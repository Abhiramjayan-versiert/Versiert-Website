import { ArrowUp } from "lucide-react";
import { navigation } from "@/data/navigation";
import { site, activeSocials } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-black pt-20">
      <div className="container-x">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="text-2xl font-semibold tracking-[-0.04em]">
              VERSIERT <span className="font-mono text-sm font-normal tracking-[0.5em] text-white/60">MEDIA</span>
            </p>
            <p className="mt-4 max-w-xs leading-relaxed text-white/55">{site.tagline}</p>
          </div>

          <nav aria-label="Footer" className="md:col-span-2">
            <p className="eyebrow">Menu</p>
            <ul className="mt-4 space-y-2">
              {navigation.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="link-line text-white/75 hover:text-white">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="md:col-span-3">
            <p className="eyebrow">Contact</p>
            <a href={`mailto:${site.email}`} className="link-line mt-4 inline-block text-white/75 hover:text-white">
              {site.email}
            </a>
            <p className="mt-2 text-white/50">
              {site.location.city}, {site.location.region}
            </p>
          </div>

          <div className="md:col-span-2">
            {activeSocials.length > 0 && (
              <>
                <p className="eyebrow">Social</p>
                <ul className="mt-4 space-y-2">
                  {activeSocials.map((s) => (
                    <li key={s.label}>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="link-line text-white/75 hover:text-white">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="mt-16 flex flex-col-reverse gap-4 border-t border-white/10 py-6 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {site.name}. All rights reserved.
          </p>
          <a href="#top" className="inline-flex items-center gap-2 hover:text-white">
            Back to top <ArrowUp className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>

      {/* Oversized wordmark */}
      <div aria-hidden className="pointer-events-none select-none overflow-hidden">
        <svg viewBox="0 0 1000 170" className="-mb-[2%] block w-full" role="presentation">
          <text
            x="500"
            y="168"
            textAnchor="middle"
            textLength="990"
            lengthAdjust="spacingAndGlyphs"
            className="fill-white/[0.06] font-semibold"
            style={{ fontSize: 215, letterSpacing: "-0.05em" }}
          >
            VERSIERT
          </text>
        </svg>
      </div>
    </footer>
  );
}
