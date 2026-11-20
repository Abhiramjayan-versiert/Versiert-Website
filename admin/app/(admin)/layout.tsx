import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { env } from "@/lib/env";
import { sections } from "@/lib/schema";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const website = sections.filter((x) => x.group === "Website").map((x) => ({ href: `/edit/${x.id}`, label: x.title }));
  const settings = sections.filter((x) => x.group === "Settings").map((x) => ({ href: `/edit/${x.id}`, label: x.title }));
  return (
    <div className="lg:flex">
      <Sidebar website={website} settings={settings} user={{ login: s.login, avatar: s.avatar }} siteUrl={env.siteUrl} backend={env.backend} />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
