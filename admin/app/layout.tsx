import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Versiert Admin", template: "%s · Versiert Admin" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-svh font-sans">{children}</body>
    </html>
  );
}
