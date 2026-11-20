"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ExternalLink, LayoutDashboard, LogOut, Menu, Boxes, Settings, X, PanelsTopLeft } from "lucide-react";

type Item = { href: string; label: string };

export function Sidebar({
  website,
  settings,
  user,
  siteUrl,
  backend,
}: {
  website: Item[];
  settings: Item[];
  user: { login: string; avatar?: string };
  siteUrl: string;
  backend: "local" | "github";
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const link = (href: string, label: string, icon?: React.ReactNode) => {
    const active = href === "/" ? path === "/" : path.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
        }`}
      >
        {icon}
        {label}
      </Link>
    );
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Admin">
      <div className="space-y-0.5">
        {link("/", "Dashboard", <LayoutDashboard className="h-4 w-4" aria-hidden />)}
        {link("/saas", "SaaS apps", <Boxes className="h-4 w-4" aria-hidden />)}
      </div>
      <div>
        <p className="eyebrow mb-2 flex items-center gap-2 px-3">
          <PanelsTopLeft className="h-3.5 w-3.5" aria-hidden /> Website
        </p>
        <div className="space-y-0.5">{website.map((i) => link(i.href, i.label))}</div>
      </div>
      <div>
        <p className="eyebrow mb-2 flex items-center gap-2 px-3">
          <Settings className="h-3.5 w-3.5" aria-hidden /> Settings
        </p>
        <div className="space-y-0.5">{settings.map((i) => link(i.href, i.label))}</div>
      </div>
    </nav>
  );

  const footer = (
    <div className="space-y-3 border-t border-white/10 p-4">
      <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost w-full">
        View website <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
      <div className="flex items-center gap-3">
        {user.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar} alt="" className="h-8 w-8 rounded-full" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs">{user.login[0]?.toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">@{user.login}</p>
          <p className="text-[0.7rem] text-white/40">{backend === "local" ? "Local files (dev)" : "Saving to GitHub"}</p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="btn btn-icon" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );

  const brand = (
    <Link href="/" className="text-lg font-semibold tracking-[-0.04em]">
      VERSIERT <span className="font-mono text-[0.6rem] font-normal tracking-[0.45em] text-tungsten">ADMIN</span>
    </Link>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-white/10 bg-char lg:flex">
        <div className="flex h-16 items-center px-6">{brand}</div>
        {nav}
        {footer}
      </aside>
      {/* Mobile */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/10 bg-char/95 px-4 backdrop-blur lg:hidden">
        {brand}
        <button className="btn btn-icon" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex h-full w-72 flex-col bg-char">
            <div className="flex h-14 items-center justify-between px-4">
              {brand}
              <button className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {nav}
            {footer}
          </div>
          <button className="flex-1 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
