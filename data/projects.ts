/**
 * Portfolio is stored in /content/projects.json (edited in the admin app).
 * Fields: title, category, client?, year?, thumbnail, previewVideo?, videoUrl?,
 * description, layout ("wide" | "tall"), isSample?
 */
import data from "@/content/projects.json";

export type Category = string;

export type Project = {
  id: string;
  title: string;
  category: Category;
  client?: string;
  year?: string;
  thumbnail: string;
  previewVideo?: string;
  videoUrl?: string;
  description: string;
  layout: "wide" | "tall";
  isSample?: boolean;
};

const d = data as {
  eyebrow: string;
  heading: string[];
  intro: string;
  sampleNote: string;
  categories: string[];
  items: Project[];
};

export const workSection = { eyebrow: d.eyebrow, heading: d.heading, intro: d.intro, sampleNote: d.sampleNote };
export const categories: string[] = d.categories;
export const projects: Project[] = d.items;
