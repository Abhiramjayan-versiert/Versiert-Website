/**
 * Global brand settings are stored in /content/site.json and edited in the
 * admin app. Environment variables, when set on the host, override the form
 * backend and canonical URL.
 */
import data from "@/content/site.json";

type SiteData = {
  name: string;
  wordmark: string;
  wordmarkSub: string;
  url: string;
  email: string;
  location: { city: string; region: string; country: string; short: string; coords: string };
  tagline: string;
  description: string;
  ctaLabel: string;
  socials: { label: string; href: string }[];
  form: { endpoint: string; web3formsKey: string };
};

const d = data as SiteData;

export const site = {
  ...d,
  url: (process.env.NEXT_PUBLIC_SITE_URL || d.url || "https://versiert.in").replace(/\/$/, ""),
  form: {
    endpoint: process.env.NEXT_PUBLIC_FORM_ENDPOINT || d.form.endpoint || "",
    web3formsKey: process.env.NEXT_PUBLIC_WEB3FORMS_KEY || d.form.web3formsKey || "",
  },
};

export const activeSocials = site.socials.filter((s) => s.href.trim() !== "");
