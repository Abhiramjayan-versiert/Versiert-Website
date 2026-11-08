import type { NextConfig } from "next";

// Static export: the FastAPI backend serves frontend/out on the same origin,
// so there is one port, no CORS, and cookies stay first-party.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  // During `npm run dev`, forward API calls to the backend.
  ...(process.env.NODE_ENV === "development"
    ? { async rewrites() { return [{ source: "/api/:path*", destination: "http://127.0.0.1:8765/api/:path*" }]; } }
    : {}),
};

export default nextConfig;
