import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="grain relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-6 text-center">
      <p className="eyebrow">Error 404 — Scene missing</p>
      <h1 className="display mt-6 text-[clamp(3.5rem,14vw,12rem)]">Cut.</h1>
      <p className="mt-6 max-w-md text-soft">This page isn&apos;t part of the final edit.</p>
      <Link href="/" className="btn btn-light mt-10">
        Back to home
      </Link>
    </main>
  );
}
