/**
 * Testimonials are stored in /content/testimonials.json (edited in the admin app).
 * Only publish real quotes, with permission. `isSample` items show a visible label.
 */
import data from "@/content/testimonials.json";

export type Testimonial = { quote: string; name: string; role?: string; isSample?: boolean };

const d = data as { show: boolean; eyebrow: string; heading: string; sampleNote: string; items: Testimonial[] };

export const testimonialsSection = { eyebrow: d.eyebrow, heading: d.heading, sampleNote: d.sampleNote };
export const showTestimonials = d.show;
export const testimonials: Testimonial[] = d.items;
