import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "./env";
import { commitFiles, getRepo, putTextFile, readBinaryFile, readTextFile, GitHubError, type CommitFile } from "./github";
import { saasSeed } from "./saas-seed";
import type { ContentFile, Section } from "./schema";
import type { Session } from "./session-core";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const LOCAL_SAAS = path.resolve(process.cwd(), ".local-data", "saas-apps.json");
const CONTENT_FILES: ContentFile[] = ["site", "home", "services", "projects", "testimonials"];

/** Same id GitHub uses for file contents, so local + GitHub modes behave alike. */
export const blobSha = (text: string) =>
  createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");

const contentPath = (file: ContentFile) => `content/${file}.json`;
const tokenOf = (s: Session) => {
  if (!s.token) throw new Error("No GitHub access on this session. Sign out and in again.");
  return s.token;
};

export type Loaded = { data: Record<string, unknown>; sha: string | null };

export async function loadContent(file: ContentFile, s: Session): Promise<Loaded> {
  if (!CONTENT_FILES.includes(file)) throw new Error("Unknown content file");
  if (env.backend === "local") {
    const text = await fs.readFile(path.join(REPO_ROOT, contentPath(file)), "utf8");
    return { data: JSON.parse(text), sha: blobSha(text) };
  }
  const f = await readTextFile(tokenOf(s), env.repo, env.branch, contentPath(file));
  if (!f) throw new Error(`content/${file}.json is missing from ${env.repo}@${env.branch}.`);
  return { data: JSON.parse(f.text), sha: f.sha };
}

export type SaasLoad = Loaded & { problem?: string; isSeed?: boolean; repoUrl?: string };

export async function loadSaas(s: Session): Promise<SaasLoad> {
  if (env.backend === "local") {
    try {
      const text = await fs.readFile(LOCAL_SAAS, "utf8");
      return { data: JSON.parse(text), sha: blobSha(text) };
    } catch {
      return { data: structuredClone(saasSeed), sha: null, isSeed: true };
    }
  }
  if (!env.saasRepo) return { data: saasSeed, sha: null, isSeed: true, problem: "SAAS_REPO isn't configured." };
  const token = tokenOf(s);
  try {
    const repo = await getRepo(token, env.saasRepo);
    if (!repo.private)
      return { data: saasSeed, sha: null, isSeed: true, problem: `${env.saasRepo} is public. Make it private before storing app details there.`, repoUrl: repo.html_url };
    const f = await readTextFile(token, env.saasRepo, repo.default_branch, env.saasPath);
    if (!f) return { data: structuredClone(saasSeed), sha: null, isSeed: true, repoUrl: repo.html_url };
    return { data: JSON.parse(f.text), sha: f.sha, repoUrl: repo.html_url };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404)
      return { data: saasSeed, sha: null, isSeed: true, problem: `Private repo ${env.saasRepo} not found (or no access). Create it on GitHub first.` };
    throw e;
  }
}

/* ---------------- images ---------------- */

export type PendingImage = { id: string; data: string; name?: string };

const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

function sniff(buf: Buffer): "webp" | "jpg" | "png" | null {
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.toString("hex", 0, 8) === "89504e470d0a1a0a") return "png";
  return null;
}

/** Validates staged uploads and decides their final paths. */
function prepareImages(images: PendingImage[]) {
  const map = new Map<string, { publicPath: string; repoPath: string; base64: string }>();
  const year = new Date().getFullYear();
  for (const img of images.slice(0, 20)) {
    if (!/^[a-z0-9-]{6,40}$/i.test(img.id)) throw new Error("Invalid image id.");
    const buf = Buffer.from(img.data, "base64");
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) throw new Error("An image is too large (max 3.5 MB after compression).");
    const ext = sniff(buf);
    if (!ext) throw new Error("Only JPG, PNG or WebP images can be uploaded.");
    const base = (img.name || "image")
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "image";
    const file = `${base}-${randomBytes(3).toString("hex")}.${ext}`;
    const publicPath = `/images/uploads/${year}/${file}`;
    map.set(img.id, { publicPath, repoPath: `public${publicPath}`, base64: buf.toString("base64") });
  }
  return map;
}

/** Replaces "pending:<id>" strings with final image paths; reports unknown ids. */
function resolvePending(value: unknown, map: Map<string, { publicPath: string }>, missing: Set<string>): unknown {
  if (typeof value === "string" && value.startsWith("pending:")) {
    const hit = map.get(value.slice(8));
    if (!hit) {
      missing.add(value);
      return "";
    }
    return hit.publicPath;
  }
  if (Array.isArray(value)) return value.map((v) => resolvePending(v, map, missing));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePending(v, map, missing)]));
  return value;
}

export function applyImages(value: unknown, images: PendingImage[]) {
  const map = prepareImages(images);
  const missing = new Set<string>();
  const resolved = resolvePending(value, map, missing);
  if (missing.size) throw new Error("An uploaded image went missing. Please choose it again.");
  // Only commit images that are actually used.
  const used = JSON.stringify(resolved);
  const files: CommitFile[] = [...map.values()]
    .filter((m) => used.includes(m.publicPath))
    .map((m) => ({ path: m.repoPath, content: m.base64, encoding: "base64" }));
  return { resolved, imageFiles: files };
}

/* ---------------- saving ---------------- */

export class ConflictError extends Error {}

export type SaveResult = { sha: string; commitSha?: string; commitUrl?: string };

export async function saveContentSection(
  s: Session,
  section: Section,
  clean: unknown,
  baseSha: string | null,
  imageFiles: CommitFile[],
): Promise<SaveResult> {
  const file = section.file as ContentFile;
  const current = await loadContent(file, s);
  if (baseSha && current.sha !== baseSha)
    throw new ConflictError("This content was changed somewhere else since you opened it. Reload the page to get the latest version, then redo your edit.");

  const next =
    section.path === ""
      ? { ...current.data, ...(clean as Record<string, unknown>) }
      : { ...current.data, [section.path]: clean };
  const text = JSON.stringify(next, null, 2) + "\n";

  if (env.backend === "local") {
    for (const f of imageFiles) {
      const dest = path.join(REPO_ROOT, f.path);
      if (!dest.startsWith(path.join(REPO_ROOT, "public", "images"))) throw new Error("Bad image path");
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(f.content, "base64"));
    }
    await fs.writeFile(path.join(REPO_ROOT, contentPath(file)), text);
    return { sha: blobSha(text) };
  }

  const message = `Admin: update ${section.title}\n\nEdited by @${s.login} in admin.versiert.in`;
  const res = await commitFiles(
    tokenOf(s),
    env.repo,
    env.branch,
    [{ path: contentPath(file), content: text, encoding: "utf-8" }, ...imageFiles],
    message,
  );
  return { sha: blobSha(text), commitSha: res.sha, commitUrl: res.url };
}

export async function saveSaas(s: Session, clean: unknown, baseSha: string | null): Promise<SaveResult> {
  const text = JSON.stringify({ apps: clean }, null, 2) + "\n";
  if (env.backend === "local") {
    try {
      const cur = await fs.readFile(LOCAL_SAAS, "utf8");
      if (baseSha && blobSha(cur) !== baseSha) throw new ConflictError("The directory changed since you opened it. Reload and try again.");
    } catch (e) {
      if (e instanceof ConflictError) throw e;
    }
    await fs.mkdir(path.dirname(LOCAL_SAAS), { recursive: true });
    await fs.writeFile(LOCAL_SAAS, text);
    return { sha: blobSha(text) };
  }
  if (!env.saasRepo) throw new Error("SAAS_REPO isn't configured on the server.");
  const token = tokenOf(s);
  const repo = await getRepo(token, env.saasRepo);
  if (!repo.private) throw new Error(`${env.saasRepo} is public. Refusing to save private app details there.`);
  const current = await readTextFile(token, env.saasRepo, repo.default_branch, env.saasPath);
  if ((current?.sha || null) !== baseSha)
    throw new ConflictError("The directory changed since you opened it. Reload and try again.");
  const res = await putTextFile(token, env.saasRepo, env.saasPath, text, `Update SaaS directory (@${s.login})`, current?.sha);
  return { sha: res.fileSha, commitSha: res.commitSha, commitUrl: res.url };
}

/* ---------------- assets (image previews) ---------------- */

const ASSET_OK = /^\/images\/[a-z0-9/_\-.]+\.(webp|jpe?g|png|svg|avif)$/i;
const TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  avif: "image/avif",
};

export async function readAsset(publicPath: string, s: Session) {
  if (!ASSET_OK.test(publicPath) || publicPath.includes("..")) return null;
  const ext = publicPath.split(".").pop()!.toLowerCase();
  let body: ArrayBuffer | Buffer | null;
  if (env.backend === "local") {
    body = await fs.readFile(path.join(REPO_ROOT, "public", publicPath)).catch(() => null);
  } else {
    body = await readBinaryFile(tokenOf(s), env.repo, env.branch, `public${publicPath}`);
  }
  if (!body) return null;
  return { body, type: TYPES[ext] || "application/octet-stream" };
}
