import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Exam Coach",
  description: "Private, local AI exam coach — runs on your own PC with Ollama.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }], apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Exam Coach", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fafaf8" }, { media: "(prefers-color-scheme: dark)", color: "#0e0e10" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
