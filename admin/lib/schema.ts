/**
 * Describes every editable section of versiert.in and the SaaS directory.
 * The same definitions drive the forms (client) and validation (server).
 */

export type ContentFile = "site" | "home" | "services" | "projects" | "testimonials";

type Base = { key: string; label: string; help?: string; placeholder?: string; required?: boolean };

export type Field =
  | (Base & { type: "text" | "textarea" | "url" | "email" })
  | (Base & { type: "boolean" })
  | (Base & { type: "select"; options: string[] | "@categories" })
  | (Base & { type: "image"; aspect?: string; maxWidth?: number })
  | (Base & { type: "strings"; itemLabel?: string })
  | (Base & { type: "group"; fields: Field[] })
  | (Base & {
      type: "list";
      itemLabel: string;
      titleKey: string;
      subtitleKey?: string;
      fields: Field[];
      template: Record<string, unknown>;
      autoId?: { key: string; from: string };
    });

export type Section = {
  id: string;
  title: string;
  group: "Website" | "Settings" | "Workspace";
  description: string;
  file: ContentFile | "saas";
  /** Key inside the file; "" means the whole file. */
  path: string;
  fields: Field[];
  /** Anchor on the public site, for "View on site". */
  anchor?: string;
};

const headingHelp = "Each line is shown on its own row in large type.";

const imageHelp = "Upload a JPG, PNG or WebP. It's resized and compressed automatically.";

export const sections: Section[] = [
  {
    id: "hero",
    title: "Hero",
    group: "Website",
    description: "The full-screen opening: headline, supporting line, buttons and background.",
    file: "home",
    path: "hero",
    anchor: "#top",
    fields: [
      { type: "strings", key: "headline", label: "Headline lines", help: headingHelp, itemLabel: "Line" },
      { type: "textarea", key: "supporting", label: "Supporting line", required: true },
      {
        type: "group",
        key: "primaryCta",
        label: "Main button",
        fields: [
          { type: "text", key: "label", label: "Label", required: true },
          { type: "url", key: "href", label: "Link", help: "Use #work, #contact etc. to jump to a section." },
        ],
      },
      {
        type: "group",
        key: "secondaryCta",
        label: "Second button",
        fields: [
          { type: "text", key: "label", label: "Label", required: true },
          { type: "url", key: "href", label: "Link" },
        ],
      },
      { type: "image", key: "image", label: "Background image", help: `${imageHelp} Landscape, 2400×1350 ideal.`, aspect: "16/9", maxWidth: 2400 },
      {
        type: "group",
        key: "video",
        label: "Background showreel (optional)",
        help: "Short, muted loop. Paste a direct .mp4/.webm link (e.g. from a CDN). Leave empty to use the image.",
        fields: [
          { type: "url", key: "mp4", label: "MP4 URL" },
          { type: "url", key: "webm", label: "WebM URL" },
        ],
      },
    ],
  },
  {
    id: "marquee",
    title: "Scrolling strip",
    group: "Website",
    description: "The words that scroll under the hero.",
    file: "home",
    path: "marquee",
    fields: [{ type: "strings", key: "", label: "Items", itemLabel: "Item" }],
  },
  {
    id: "about",
    title: "About",
    group: "Website",
    description: "“More than just production.”: introduction, images and pillars.",
    file: "home",
    path: "about",
    anchor: "#about",
    fields: [
      { type: "text", key: "eyebrow", label: "Small label" },
      { type: "strings", key: "heading", label: "Heading lines", help: headingHelp, itemLabel: "Line" },
      { type: "textarea", key: "lead", label: "Lead paragraph", required: true },
      { type: "strings", key: "body", label: "Body paragraphs", itemLabel: "Paragraph" },
      { type: "strings", key: "pillars", label: "Pillars", itemLabel: "Pillar" },
      {
        type: "group",
        key: "images",
        label: "Images",
        fields: [
          {
            type: "group",
            key: "primary",
            label: "Large image (portrait 4:5)",
            fields: [
              { type: "image", key: "src", label: "Image", help: imageHelp, aspect: "4/5", maxWidth: 1400 },
              { type: "text", key: "alt", label: "Description (for screen readers)" },
            ],
          },
          {
            type: "group",
            key: "secondary",
            label: "Small image (4:3)",
            fields: [
              { type: "image", key: "src", label: "Image", help: imageHelp, aspect: "4/3", maxWidth: 1200 },
              { type: "text", key: "alt", label: "Description (for screen readers)" },
            ],
          },
        ],
      },
      { type: "text", key: "badge", label: "Rotating badge text", help: "Separate words with · and end with a space." },
    ],
  },
  {
    id: "services",
    title: "Services",
    group: "Website",
    description: "Section intro and every service: name, description, image and tags.",
    file: "services",
    path: "",
    anchor: "#services",
    fields: [
      { type: "text", key: "eyebrow", label: "Small label" },
      { type: "strings", key: "heading", label: "Heading lines", help: headingHelp, itemLabel: "Line" },
      { type: "textarea", key: "intro", label: "Intro text" },
      {
        type: "list",
        key: "items",
        label: "Services",
        itemLabel: "Service",
        titleKey: "title",
        subtitleKey: "description",
        autoId: { key: "slug", from: "title" },
        template: { slug: "", title: "New service", description: "", image: "", alt: "", tags: [] },
        fields: [
          { type: "text", key: "title", label: "Name", required: true },
          { type: "textarea", key: "description", label: "Description", required: true },
          { type: "image", key: "image", label: "Image", help: `${imageHelp} Portrait 4:5.`, aspect: "4/5", maxWidth: 1200 },
          { type: "text", key: "alt", label: "Image description (for screen readers)" },
          { type: "strings", key: "tags", label: "Tags", itemLabel: "Tag" },
        ],
      },
    ],
  },
  {
    id: "work",
    title: "Portfolio",
    group: "Website",
    description: "Projects, categories and the section intro. Replace the sample projects here.",
    file: "projects",
    path: "",
    anchor: "#work",
    fields: [
      { type: "text", key: "eyebrow", label: "Small label" },
      { type: "strings", key: "heading", label: "Heading lines", help: headingHelp, itemLabel: "Line" },
      { type: "textarea", key: "intro", label: "Intro text" },
      {
        type: "textarea",
        key: "sampleNote",
        label: "Note shown while sample projects exist",
        help: "Hidden automatically once no project is marked as a sample.",
      },
      { type: "strings", key: "categories", label: "Categories (filters)", itemLabel: "Category" },
      {
        type: "list",
        key: "items",
        label: "Projects",
        itemLabel: "Project",
        titleKey: "title",
        subtitleKey: "category",
        autoId: { key: "id", from: "title" },
        template: {
          id: "",
          title: "New project",
          category: "",
          client: "",
          year: "",
          thumbnail: "",
          previewVideo: "",
          videoUrl: "",
          description: "",
          layout: "wide",
          isSample: false,
        },
        fields: [
          { type: "text", key: "title", label: "Title", required: true },
          { type: "select", key: "category", label: "Category", options: "@categories", required: true },
          { type: "text", key: "client", label: "Client (optional, only with permission)" },
          { type: "text", key: "year", label: "Year (optional)" },
          { type: "image", key: "thumbnail", label: "Thumbnail", help: `${imageHelp} 16:9 for wide, 4:5 for tall.`, maxWidth: 1920 },
          { type: "select", key: "layout", label: "Tile shape", options: ["wide", "tall"] },
          { type: "url", key: "videoUrl", label: "Video link", help: "YouTube, Vimeo or a direct .mp4 link. Plays in the project pop-up." },
          { type: "url", key: "previewVideo", label: "Hover preview loop (optional)", help: "Short muted .mp4, under 3 MB." },
          { type: "textarea", key: "description", label: "Description", required: true },
          { type: "boolean", key: "isSample", label: "Sample placeholder", help: "Shows a “Sample” label. Turn off for real projects." },
        ],
      },
    ],
  },
  {
    id: "process",
    title: "Our approach",
    group: "Website",
    description: "The four-step production process timeline.",
    file: "home",
    path: "process",
    fields: [
      { type: "text", key: "eyebrow", label: "Small label" },
      { type: "strings", key: "heading", label: "Heading lines", help: headingHelp, itemLabel: "Line" },
      {
        type: "list",
        key: "steps",
        label: "Steps",
        itemLabel: "Step",
        titleKey: "title",
        subtitleKey: "text",
        template: { no: "", title: "New step", text: "" },
        fields: [
          { type: "text", key: "no", label: "Number", placeholder: "05" },
          { type: "text", key: "title", label: "Title", required: true },
          { type: "textarea", key: "text", label: "Text", required: true },
        ],
      },
    ],
  },
  {
    id: "why",
    title: "Why Versiert",
    group: "Website",
    description: "The reasons to work with you.",
    file: "home",
    path: "why",
    fields: [
      { type: "text", key: "eyebrow", label: "Small label" },
      { type: "strings", key: "heading", label: "Heading lines", help: headingHelp, itemLabel: "Line" },
      {
        type: "list",
        key: "points",
        label: "Points",
        itemLabel: "Point",
        titleKey: "title",
        subtitleKey: "text",
        template: { title: "New point", text: "" },
        fields: [
          { type: "text", key: "title", label: "Title", required: true },
          { type: "textarea", key: "text", label: "Text", required: true },
        ],
      },
    ],
  },
  {
    id: "testimonials",
    title: "Testimonials",
    group: "Website",
    description: "Client quotes. Only publish real quotes, with permission.",
    file: "testimonials",
    path: "",
    fields: [
      { type: "boolean", key: "show", label: "Show this section on the website" },
      { type: "text", key: "eyebrow", label: "Small label" },
      { type: "text", key: "heading", label: "Heading" },
      { type: "textarea", key: "sampleNote", label: "Note shown while sample quotes exist" },
      {
        type: "list",
        key: "items",
        label: "Testimonials",
        itemLabel: "Testimonial",
        titleKey: "name",
        subtitleKey: "quote",
        template: { quote: "", name: "", role: "", isSample: false },
        fields: [
          { type: "textarea", key: "quote", label: "Quote", required: true },
          { type: "text", key: "name", label: "Name", required: true },
          { type: "text", key: "role", label: "Role, company" },
          { type: "boolean", key: "isSample", label: "Sample placeholder", help: "Shows a “Sample testimonial” label." },
        ],
      },
    ],
  },
  {
    id: "contact",
    title: "Contact",
    group: "Website",
    description: "Closing section: headline, budgets and backdrop image.",
    file: "home",
    path: "contact",
    anchor: "#contact",
    fields: [
      { type: "text", key: "eyebrow", label: "Small label" },
      { type: "strings", key: "headline", label: "Headline lines", help: headingHelp, itemLabel: "Line" },
      { type: "textarea", key: "supporting", label: "Supporting line" },
      { type: "image", key: "backdrop", label: "Backdrop image", help: imageHelp, aspect: "5/3", maxWidth: 2000 },
      { type: "strings", key: "budgets", label: "Budget ranges (form options)", itemLabel: "Range" },
    ],
  },
  {
    id: "settings",
    title: "Brand & contact details",
    group: "Settings",
    description: "Name, email, location, social links, contact-form delivery and SEO description.",
    file: "site",
    path: "",
    fields: [
      { type: "text", key: "name", label: "Company name", required: true },
      { type: "text", key: "wordmark", label: "Logo word", required: true },
      { type: "text", key: "wordmarkSub", label: "Logo sub-word" },
      { type: "email", key: "email", label: "Contact email", required: true, help: "Shown on the site and receives mailto enquiries." },
      { type: "text", key: "ctaLabel", label: "Header button label", required: true },
      { type: "textarea", key: "tagline", label: "Footer tagline" },
      { type: "textarea", key: "description", label: "Search & social description", help: "Shown in Google results and link previews. ~155 characters." },
      { type: "url", key: "url", label: "Website address", help: "Canonical URL used for SEO, e.g. https://versiert.in" },
      {
        type: "group",
        key: "location",
        label: "Location",
        fields: [
          { type: "text", key: "city", label: "City" },
          { type: "text", key: "region", label: "State / region" },
          { type: "text", key: "country", label: "Country" },
          { type: "text", key: "short", label: "Short form (hero)", placeholder: "Trivandrum, India" },
          { type: "text", key: "coords", label: "Coordinates (decorative)" },
        ],
      },
      {
        type: "list",
        key: "socials",
        label: "Social links",
        help: "Links with an empty URL are hidden on the site.",
        itemLabel: "Social link",
        titleKey: "label",
        subtitleKey: "href",
        template: { label: "", href: "" },
        fields: [
          { type: "text", key: "label", label: "Name", required: true, placeholder: "Instagram" },
          { type: "url", key: "href", label: "Profile URL", placeholder: "https://instagram.com/…" },
        ],
      },
      {
        type: "group",
        key: "form",
        label: "Contact form delivery",
        help: "Leave both empty to use the email-app (mailto) fallback.",
        fields: [
          { type: "text", key: "web3formsKey", label: "Web3Forms access key", help: "Free at web3forms.com. This key is public by design." },
          { type: "url", key: "endpoint", label: "Or a Formspree endpoint", placeholder: "https://formspree.io/f/…" },
        ],
      },
    ],
  },
  {
    id: "saas",
    title: "SaaS apps",
    group: "Workspace",
    description: "Your private directory of apps: what each is for, who uses it, and every link.",
    file: "saas",
    path: "apps",
    fields: [
      {
        type: "list",
        key: "",
        label: "Apps",
        itemLabel: "App",
        titleKey: "name",
        subtitleKey: "purpose",
        autoId: { key: "id", from: "name" },
        template: {
          id: "",
          name: "New app",
          status: "In development",
          purpose: "",
          users: "",
          liveUrl: "",
          adminUrl: "",
          repoUrl: "",
          hosting: "",
          database: "",
          stack: [],
          links: [],
          notes: "",
        },
        fields: [
          { type: "text", key: "name", label: "App name", required: true },
          { type: "select", key: "status", label: "Status", options: ["Live", "In development", "Paused", "Archived"] },
          { type: "textarea", key: "purpose", label: "What it's used for" },
          { type: "textarea", key: "users", label: "Who uses it", placeholder: "e.g. College election admins and voters" },
          { type: "url", key: "liveUrl", label: "Live app URL" },
          { type: "url", key: "adminUrl", label: "Admin / dashboard URL" },
          { type: "url", key: "repoUrl", label: "Code repository" },
          { type: "text", key: "hosting", label: "Hosting", placeholder: "Vercel · project-name" },
          { type: "text", key: "database", label: "Database", placeholder: "Supabase · project-name" },
          { type: "strings", key: "stack", label: "Tech stack", itemLabel: "Technology" },
          {
            type: "list",
            key: "links",
            label: "Other links",
            itemLabel: "Link",
            titleKey: "label",
            subtitleKey: "url",
            template: { label: "", url: "" },
            fields: [
              { type: "text", key: "label", label: "Label", required: true },
              { type: "url", key: "url", label: "URL", required: true },
            ],
          },
          {
            type: "textarea",
            key: "notes",
            label: "Notes",
            help: "Don't store passwords or API keys here. Use a password manager.",
          },
        ],
      },
    ],
  },
];

export const sectionById = (id: string) => sections.find((s) => s.id === id);
