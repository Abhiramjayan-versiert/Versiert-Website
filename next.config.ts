import type { NextConfig } from "next";

/**
 * Fully static build (`next build` → /out). Works on Vercel and on any static
 * host (Cloudflare Pages, Netlify, GitHub Pages…). Images are pre-compressed
 * WebP files in /public/images, so the runtime optimiser is not required.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
