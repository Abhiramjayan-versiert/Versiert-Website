import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { contact } from "@/data/content";
import { site, activeSocials } from "@/lib/site";
import { ContactForm } from "./ContactForm";
import { MaskLines, Reveal } from "./Reveal";

export function Contact() {
  return (
    <section id="contact" aria-labelledby="contact-title" className="relative isolate overflow-hidden bg-black pb-24 pt-28 md:pb-36 md:pt-44">
      <div className="absolute inset-x-0 top-0 -z-10 h-[70vh]" aria-hidden>
        <Image src={contact.backdrop} alt="" fill sizes="100vw" className="object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black/30 to-black" />
      </div>

      <div className="container-x">
        <Reveal>
          <p className="eyebrow flex items-center gap-3">
            <span className="text-white/90">(07)</span>
            <span className="h-px w-8 bg-white/30" aria-hidden />
            {contact.eyebrow}
          </p>
        </Reveal>
        <h2 id="contact-title" className="display mt-8 text-[clamp(3.2rem,12vw,12rem)]">
          <MaskLines lines={contact.headline} />
        </h2>
        <Reveal delay={0.15}>
          <p className="mt-8 text-xl text-white/70 md:text-2xl">{contact.supporting}</p>
        </Reveal>

        <div className="mt-20 grid gap-16 border-t border-white/12 pt-14 lg:grid-cols-12 lg:gap-10">
          <Reveal className="space-y-10 lg:col-span-4">
            <div>
              <p className="eyebrow">Email</p>
              <a
                href={`mailto:${site.email}`}
                className="group mt-3 inline-flex items-center gap-2 break-all text-2xl font-medium tracking-[-0.02em] md:text-3xl"
                data-cursor="hover"
              >
                <span className="link-line">{site.email}</span>
                <ArrowUpRight className="h-5 w-5 shrink-0 transition-transform duration-500 group-hover:rotate-45" aria-hidden />
              </a>
            </div>
            <div>
              <p className="eyebrow">Studio</p>
              <address className="mt-3 not-italic leading-relaxed text-white/75">
                {site.location.city}
                <br />
                {site.location.region}, {site.location.country}
              </address>
            </div>
            {activeSocials.length > 0 && (
              <div>
                <p className="eyebrow">Follow</p>
                <ul className="mt-3 space-y-1.5">
                  {activeSocials.map((s) => (
                    <li key={s.label}>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="link-line text-white/75 hover:text-white">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Reveal>

          <Reveal delay={0.1} className="lg:col-span-8">
            <ContactForm />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
