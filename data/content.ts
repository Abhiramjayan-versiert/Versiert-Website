/**
 * Page copy is stored in /content/home.json and edited in the admin app
 * (admin.versiert.in). This file only gives it types.
 */
import home from "@/content/home.json";

export type Cta = { label: string; href: string };
export type Step = { no: string; title: string; text: string };
export type Point = { title: string; text: string };

type Home = {
  hero: {
    headline: string[];
    supporting: string;
    primaryCta: Cta;
    secondaryCta: Cta;
    image: string;
    video: { mp4: string; webm: string };
  };
  marquee: string[];
  about: {
    eyebrow: string;
    heading: string[];
    lead: string;
    body: string[];
    pillars: string[];
    images: { primary: { src: string; alt: string }; secondary: { src: string; alt: string } };
    badge: string;
  };
  process: { eyebrow: string; heading: string[]; steps: Step[] };
  why: { eyebrow: string; heading: string[]; points: Point[] };
  contact: { eyebrow: string; headline: string[]; supporting: string; backdrop: string; budgets: string[] };
};

const data = home as Home;

export const hero = data.hero;
export const marquee = data.marquee;
export const about = data.about;
export const process = data.process;
export const why = data.why;
export const contact = data.contact;
