/**
 * PAGE COPY — hero, about, approach, "why", contact.
 * Edit text here; components read from this file.
 */

export const hero = {
  headline: ["We make", "visuals", "matter."],
  supporting: "Stories, frames and experiences crafted to make brands impossible to ignore.",
  primaryCta: { label: "Explore Our Work", href: "#work" },
  secondaryCta: { label: "Contact Us", href: "#contact" },

  /** Background still (always used as the poster / fallback). */
  image: "/images/hero/hero.webp",

  /**
   * OPTIONAL background showreel. Keep it short (10–20 s), muted, 1080p max,
   * ideally < 6 MB. Put files in /public/videos or use a CDN URL.
   * Leave both empty to use the still image only.
   * It is not loaded for visitors with reduced-motion or data-saver enabled.
   */
  video: {
    mp4: "", // e.g. "/videos/showreel.mp4"
    webm: "", // e.g. "/videos/showreel.webm"
  },
};

export const marquee = [
  "Video Production",
  "Commercial Films",
  "Social Media Reels",
  "Brand Films",
  "Photography",
  "Event Coverage",
  "Podcasts",
  "Post-production",
];

export const about = {
  eyebrow: "About",
  heading: "More than just production.",
  lead: "Versiert Media is a creative production company that makes meaningful visual content for brands, businesses and individuals.",
  body: [
    "We bring creative thinking, production and storytelling together under one roof. Every project starts with understanding what a brand stands for and who it needs to reach — then we shape the idea, plan every frame and produce it with care.",
    "The result is content that does more than look good. It communicates identity, earns attention and gives people a reason to remember you.",
  ],
  pillars: ["Creative thinking", "Production", "Storytelling"],
  images: {
    primary: { src: "/images/about/about-1.webp", alt: "Light falling through a doorway in a dark studio" },
    secondary: { src: "/images/about/about-2.webp", alt: "Softbox light on a dark set" },
  },
  badge: "Ideas · Frames · Stories · Motion · ",
};

export const process = {
  eyebrow: "Our Approach",
  heading: "From first idea to final frame.",
  steps: [
    { no: "01", title: "Understand", text: "Understand the brand, audience and objective." },
    { no: "02", title: "Conceptualise", text: "Develop the creative direction and storytelling." },
    { no: "03", title: "Produce", text: "Bring the concept to life through professional production." },
    { no: "04", title: "Deliver", text: "Edit, refine and deliver the final output." },
  ],
};

export const why = {
  eyebrow: "Why Versiert Media",
  heading: "Made with intent. Built around your objective.",
  points: [
    {
      title: "Creative-first thinking",
      text: "We start with the idea, not the equipment. Every piece begins with a clear creative direction.",
    },
    {
      title: "Strong visual storytelling",
      text: "Framing, light, pace and sound are used deliberately to tell your story — not just to fill a screen.",
    },
    {
      title: "Attention to detail",
      text: "From wardrobe and set dressing to colour and sound mix, the small things are treated as the big things.",
    },
    {
      title: "Professional production",
      text: "Planned shoots, organised crews and a considered post-production workflow from start to finish.",
    },
    {
      title: "Built around brand objectives",
      text: "Content is shaped around what it needs to achieve — awareness, engagement, launch or long-term identity.",
    },
  ],
};

export const contact = {
  eyebrow: "Contact",
  headline: ["Have a story", "to tell?"],
  supporting: "Let's create something worth remembering.",
  backdrop: "/images/contact/contact.webp",
  budgets: [
    "Under ₹50,000",
    "₹50,000 – ₹1,50,000",
    "₹1,50,000 – ₹5,00,000",
    "₹5,00,000+",
    "Not sure yet",
  ],
};
