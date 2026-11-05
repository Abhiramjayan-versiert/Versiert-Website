/**
 * SERVICES — add, remove or reorder entries freely.
 * `image` lives in /public/images/services (replace with your own stills).
 */
export type Service = {
  slug: string;
  title: string;
  description: string;
  image: string;
  alt: string;
  tags: string[];
};

export const services: Service[] = [
  {
    slug: "video-production",
    title: "Video Production",
    description:
      "End-to-end production — from concept and pre-production to shoot day and final delivery — for content that looks and feels considered.",
    image: "/images/services/video-production.webp",
    alt: "Abstract camera lens rings in low light",
    tags: ["Concept", "Pre-production", "Shoot"],
  },
  {
    slug: "commercial-ad-films",
    title: "Commercial & Ad Films",
    description:
      "Campaign-ready commercials built around a single idea, crafted for TV, digital and in-cinema placements.",
    image: "/images/services/commercial-ad-films.webp",
    alt: "Anamorphic light streaks across a dark frame",
    tags: ["TVC", "Digital", "Campaign"],
  },
  {
    slug: "social-media-reels",
    title: "Social Media Reels",
    description:
      "Short-form vertical content designed for the first three seconds — fast, native to the platform and true to your brand.",
    image: "/images/services/social-media-reels.webp",
    alt: "Soft out-of-focus lights",
    tags: ["Reels", "Shorts", "Vertical"],
  },
  {
    slug: "brand-films",
    title: "Brand Films & Storytelling",
    description:
      "Longer-form films that capture what a brand believes in — its people, process and purpose — told with honesty and craft.",
    image: "/images/services/brand-films.webp",
    alt: "Low sun glowing on a dark horizon",
    tags: ["Documentary", "Narrative", "Founder stories"],
  },
  {
    slug: "photography",
    title: "Photography & Modelling Shoots",
    description:
      "Editorial, product, campaign and portfolio photography with art direction, lighting and styling handled in-house.",
    image: "/images/services/photography.webp",
    alt: "Studio softbox light",
    tags: ["Editorial", "Product", "Portfolio"],
  },
  {
    slug: "event-coverage",
    title: "Event Coverage",
    description:
      "Multi-camera coverage of launches, conferences, performances and celebrations — delivered as highlights, reels and full edits.",
    image: "/images/services/event-coverage.webp",
    alt: "Stage spotlight cutting through haze",
    tags: ["Launches", "Conferences", "Live"],
  },
  {
    slug: "podcast",
    title: "Podcast & Interview Production",
    description:
      "Lit, framed and mic'd properly. Multi-camera video podcasts and interviews with clean audio and ready-to-post clips.",
    image: "/images/services/podcast.webp",
    alt: "Dimly lit podcast set with a microphone",
    tags: ["Video podcast", "Interviews", "Clips"],
  },
  {
    slug: "post-production",
    title: "Post-production & Video Editing",
    description:
      "Editing, colour grading, sound design, motion graphics and finishing — for our productions or footage you already have.",
    image: "/images/services/post-production.webp",
    alt: "Flowing lines of light",
    tags: ["Edit", "Colour", "Sound"],
  },
];
