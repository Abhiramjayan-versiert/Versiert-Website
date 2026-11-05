export type NavItem = { label: string; href: string };

/** Main navigation. `href` values are section anchors on the home page. */
export const navigation: NavItem[] = [
  { label: "Home", href: "#top" },
  { label: "About", href: "#about" },
  { label: "Services", href: "#services" },
  { label: "Our Work", href: "#work" },
  { label: "Contact", href: "#contact" },
];

export const ctaLabel = "Let's Talk";
