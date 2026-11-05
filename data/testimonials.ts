/**
 * TESTIMONIALS
 *
 * The entries below are SAMPLE PLACEHOLDERS and are labelled as such on the
 * site. Never publish invented reviews. Replace with real, permitted quotes
 * from clients and set `isSample: false`.
 *
 * To hide the whole section until you have real testimonials, set
 * `showTestimonials` to false.
 */
export type Testimonial = {
  quote: string;
  name: string;
  role?: string;
  isSample?: boolean;
};

export const showTestimonials = true;

export const testimonials: Testimonial[] = [
  {
    quote:
      "Sample testimonial. A short, specific quote from a real client about working with Versiert Media will appear here.",
    name: "Client name",
    role: "Role, Company",
    isSample: true,
  },
  {
    quote:
      "Sample testimonial. Ask clients what changed for them — the clearer and more specific the quote, the more it builds trust.",
    name: "Client name",
    role: "Role, Company",
    isSample: true,
  },
  {
    quote: "Sample testimonial. Keep quotes to one to three sentences and always get permission to publish.",
    name: "Client name",
    role: "Role, Company",
    isSample: true,
  },
];
