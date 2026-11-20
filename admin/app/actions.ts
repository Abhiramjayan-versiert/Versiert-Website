"use server";

import { env } from "@/lib/env";
import { commitDeployState } from "@/lib/github";
import { sectionById } from "@/lib/schema";
import { endSession, requireSession } from "@/lib/session";
import { ConflictError, applyImages, loadContent, saveContentSection, saveSaas, type PendingImage } from "@/lib/store";
import { cleanSectionValue } from "@/lib/validate";
import { redirect } from "next/navigation";

export type SaveResponse =
  | { ok: true; sha: string; commitSha?: string; commitUrl?: string; value: unknown }
  | { ok: false; error: string; errors?: string[]; conflict?: boolean };

export async function saveSectionAction(input: {
  sectionId: string;
  value: unknown;
  baseSha: string | null;
  images: PendingImage[];
}): Promise<SaveResponse> {
  try {
    const s = await requireSession();
    const section = sectionById(String(input.sectionId));
    if (!section) return { ok: false, error: "Unknown section." };

    const images = Array.isArray(input.images) ? input.images : [];
    if (section.file === "saas" && images.length) return { ok: false, error: "Images aren't supported here." };
    const { resolved, imageFiles } = applyImages(input.value, images);

    const ctx: { errors: string[]; categories?: string[] } = { errors: [] };
    if (section.id === "work") {
      const v = resolved as { categories?: unknown };
      ctx.categories = Array.isArray(v?.categories) ? v.categories.map(String).map((x) => x.trim()).filter(Boolean) : [];
    }
    const clean = cleanSectionValue(section.fields, resolved, ctx);
    if (ctx.errors.length) return { ok: false, error: "Please fix the highlighted problems.", errors: ctx.errors.slice(0, 20) };

    const res =
      section.file === "saas"
        ? await saveSaas(s, clean, input.baseSha)
        : await saveContentSection(s, section, clean, input.baseSha, imageFiles);
    return { ok: true, ...res, value: clean };
  } catch (e) {
    if (e instanceof ConflictError) return { ok: false, error: e.message, conflict: true };
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong while saving." };
  }
}

export async function deployStatusAction(commitSha: string) {
  const s = await requireSession();
  if (env.backend === "local" || !/^[0-9a-f]{40}$/.test(commitSha)) return { state: "unknown" as const };
  try {
    return await commitDeployState(s.token!, env.repo, commitSha);
  } catch {
    return { state: "unknown" as const };
  }
}

export async function reloadSectionAction(sectionId: string) {
  const s = await requireSession();
  const section = sectionById(sectionId);
  if (!section || section.file === "saas") return null;
  const f = await loadContent(section.file, s);
  return { sha: f.sha, value: section.path ? f.data[section.path] : f.data };
}

export async function signOutAction() {
  await endSession();
  redirect("/login");
}
