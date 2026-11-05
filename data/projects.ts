/**
 * PORTFOLIO — the single source of truth for the "Our Work" section.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ Every entry below is a SAMPLE PLACEHOLDER (`isSample: true`). They are │
 * │ shown with a visible "Sample" label. Replace them with real projects  │
 * │ and set `isSample: false` (or delete the field).                      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Fields
 *  - title        Project name
 *  - category     One of `categories` below
 *  - client       Optional. Only add with the client's permission.
 *  - year         Optional
 *  - thumbnail    Path in /public/images/work (16:9 or 4:5 work best)
 *  - previewVideo Optional short, muted, silent loop (≤ 3 MB mp4) played on hover
 *  - videoUrl     Optional full video: YouTube, Vimeo or a direct .mp4 URL
 *  - description  One or two sentences
 *  - layout       "wide" (landscape) or "tall" (portrait) tile in the grid
 */

export const categories = [
  "Commercial Films",
  "Social Media Content",
  "Brand Campaigns",
  "Photography",
  "Events",
  "Creative Projects",
] as const;

export type Category = (typeof categories)[number];

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

export const projects: Project[] = [
  {
    id: "sample-commercial",
    title: "Sample Commercial Film",
    category: "Commercial Films",
    thumbnail: "/images/work/sample-01.webp",
    videoUrl: "",
    description:
      "Placeholder for a 30–60 second commercial. Replace with your project title, a still from the film and the YouTube or Vimeo link.",
    layout: "wide",
    isSample: true,
  },
  {
    id: "sample-reel-series",
    title: "Sample Reel Series",
    category: "Social Media Content",
    thumbnail: "/images/work/sample-02.webp",
    description:
      "Placeholder for a vertical reel series. Portrait thumbnails suit this tile — add a short hover loop with `previewVideo`.",
    layout: "tall",
    isSample: true,
  },
  {
    id: "sample-brand-campaign",
    title: "Sample Brand Campaign",
    category: "Brand Campaigns",
    thumbnail: "/images/work/sample-03.webp",
    description:
      "Placeholder for a multi-format campaign — hero film, cut-downs and stills. Replace with the real campaign details.",
    layout: "wide",
    isSample: true,
  },
  {
    id: "sample-editorial",
    title: "Sample Editorial Shoot",
    category: "Photography",
    thumbnail: "/images/work/sample-04.webp",
    description: "Placeholder for a photography or modelling shoot. Use your strongest frame as the thumbnail.",
    layout: "tall",
    isSample: true,
  },
  {
    id: "sample-event",
    title: "Sample Event Highlights",
    category: "Events",
    thumbnail: "/images/work/sample-05.webp",
    description: "Placeholder for an event highlight film. Replace with the event name and highlight video link.",
    layout: "wide",
    isSample: true,
  },
  {
    id: "sample-creative",
    title: "Sample Creative Project",
    category: "Creative Projects",
    thumbnail: "/images/work/sample-06.webp",
    description: "Placeholder for a personal or experimental piece — music video, short film or visual study.",
    layout: "wide",
    isSample: true,
  },
  {
    id: "sample-portrait",
    title: "Sample Portrait Series",
    category: "Photography",
    thumbnail: "/images/work/sample-07.webp",
    description: "Placeholder for a portrait or product series.",
    layout: "tall",
    isSample: true,
  },
  {
    id: "sample-launch",
    title: "Sample Product Launch Film",
    category: "Commercial Films",
    thumbnail: "/images/work/sample-08.webp",
    description: "Placeholder for a product launch film.",
    layout: "wide",
    isSample: true,
  },
];
