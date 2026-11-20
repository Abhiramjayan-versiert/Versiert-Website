/** Services are stored in /content/services.json (edited in the admin app). */
import data from "@/content/services.json";

export type Service = {
  slug: string;
  title: string;
  description: string;
  image: string;
  alt: string;
  tags: string[];
};

const d = data as { eyebrow: string; heading: string[]; intro: string; items: Service[] };

export const servicesSection = { eyebrow: d.eyebrow, heading: d.heading, intro: d.intro };
export const services: Service[] = d.items;
