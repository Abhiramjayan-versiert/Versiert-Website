import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <div className="text-lg font-semibold">Page not found</div>
        <Link href="/" className="muted mt-2 block text-sm underline">Back to dashboard</Link>
      </div>
    </div>
  );
}
