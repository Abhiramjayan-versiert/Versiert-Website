/**
 * GLOBAL SITE SETTINGS — edit this file to change brand details site-wide.
 */
export const site = {
  name: "Versiert Media",
  wordmark: "VERSIERT",
  wordmarkSub: "MEDIA",

  /** Canonical URL. Set NEXT_PUBLIC_SITE_URL in your host to override. */
  url: (process.env.NEXT_PUBLIC_SITE_URL || "https://versiert.in").replace(/\/$/, ""),

  email: "hello@versiert.in",

  location: {
    city: "Thiruvananthapuram",
    region: "Kerala",
    country: "India",
    short: "Trivandrum, India",
    /** Approximate city-centre coordinates, used only as a decorative detail. */
    coords: "8.5241° N, 76.9366° E",
  },

  tagline: "Independent creative production studio based in Trivandrum, India.",
  description:
    "Versiert Media is a creative media production company in Thiruvananthapuram, Kerala — producing video, commercial and ad films, brand films, social media reels, photography, event coverage, podcasts and post-production for brands, businesses and individuals.",

  /**
   * Social links. Leave `href` empty to hide a link (no broken links are ever
   * rendered). Paste your full profile URLs to show them in the footer and
   * contact section.
   */
  socials: [
    { label: "Instagram", href: "" },
    { label: "YouTube", href: "" },
    { label: "LinkedIn", href: "" },
    { label: "Vimeo", href: "" },
    { label: "Behance", href: "" },
  ] as { label: string; href: string }[],

  /** Contact form backend (see .env.example). Empty = mailto fallback. */
  form: {
    endpoint: process.env.NEXT_PUBLIC_FORM_ENDPOINT || "",
    web3formsKey: process.env.NEXT_PUBLIC_WEB3FORMS_KEY || "",
  },
} as const;

export const activeSocials = site.socials.filter((s) => s.href.trim() !== "");
