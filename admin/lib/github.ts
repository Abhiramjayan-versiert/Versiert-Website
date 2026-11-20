import "server-only";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gh<T>(token: string, path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const { raw, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "versiert-admin",
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { message?: string }).message || msg;
    } catch {}
    throw new GitHubError(res.status, `GitHub: ${msg} (${res.status})`);
  }
  if (raw) return (await res.arrayBuffer()) as T;
  return (await res.json()) as T;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export type RepoInfo = { private: boolean; default_branch: string; html_url: string; full_name: string };

export function getRepo(token: string, repo: string) {
  return gh<RepoInfo>(token, `/repos/${repo}`);
}

/** Returns file text + blob sha, or null if it doesn't exist. */
export async function readTextFile(token: string, repo: string, branch: string, path: string) {
  try {
    const meta = await gh<{ sha: string; content?: string; encoding?: string; size: number }>(
      token,
      `/repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`,
    );
    let text: string;
    if (meta.content && meta.encoding === "base64") {
      text = Buffer.from(meta.content, "base64").toString("utf8");
    } else {
      const buf = await gh<ArrayBuffer>(token, `/repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`, {
        raw: true,
      });
      text = Buffer.from(buf).toString("utf8");
    }
    return { text, sha: meta.sha };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

export async function readBinaryFile(token: string, repo: string, branch: string, path: string) {
  try {
    return await gh<ArrayBuffer>(token, `/repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`, {
      raw: true,
    });
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

export type CommitFile = { path: string; content: string; encoding: "utf-8" | "base64" };

/** Commits several files to a branch in ONE commit (fast-forward only). */
export async function commitFiles(token: string, repo: string, branch: string, files: CommitFile[], message: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await gh<{ object: { sha: string } }>(token, `/repos/${repo}/git/ref/heads/${enc(branch)}`);
    const head = ref.object.sha;
    const headCommit = await gh<{ tree: { sha: string } }>(token, `/repos/${repo}/git/commits/${head}`);

    const tree = await Promise.all(
      files.map(async (f) => {
        const blob = await gh<{ sha: string }>(token, `/repos/${repo}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: f.content, encoding: f.encoding }),
        });
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );
    const newTree = await gh<{ sha: string }>(token, `/repos/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
    });
    const commit = await gh<{ sha: string; html_url: string }>(token, `/repos/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }),
    });
    try {
      await gh(token, `/repos/${repo}/git/refs/heads/${enc(branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return { sha: commit.sha, url: `https://github.com/${repo}/commit/${commit.sha}` };
    } catch (e) {
      // Someone pushed in between: retry once on top of the new head.
      if (attempt === 0 && e instanceof GitHubError && e.status === 422) continue;
      throw e;
    }
  }
  throw new Error("Could not save: the branch kept changing. Try again.");
}

/** Single-file write via the contents API (works on empty repos too). */
export async function putTextFile(
  token: string,
  repo: string,
  path: string,
  text: string,
  message: string,
  sha?: string,
  branch?: string,
) {
  const res = await gh<{ commit: { sha: string; html_url: string }; content: { sha: string } }>(
    token,
    `/repos/${repo}/contents/${enc(path)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: Buffer.from(text, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
        ...(branch ? { branch } : {}),
      }),
    },
  );
  return { commitSha: res.commit.sha, url: res.commit.html_url, fileSha: res.content.sha };
}

export type DeployState = "pending" | "success" | "failure" | "unknown";

/** Vercel reports its build result back to GitHub as a commit status. */
export async function commitDeployState(token: string, repo: string, sha: string): Promise<{ state: DeployState; url?: string }> {
  const s = await gh<{ state: string; statuses: { context: string; state: string; target_url?: string }[] }>(
    token,
    `/repos/${repo}/commits/${sha}/status`,
  );
  const vercel = s.statuses.find((x) => /vercel/i.test(x.context) && !/admin/i.test(x.context));
  if (!vercel) {
    // Vercel also uses GitHub Deployments; fall back to that.
    const deps = await gh<{ id: number; environment: string }[]>(token, `/repos/${repo}/deployments?sha=${sha}&per_page=5`);
    const dep = deps.find((d) => !/admin/i.test(d.environment)) || deps[0];
    if (!dep) return { state: "pending" };
    const st = await gh<{ state: string; environment_url?: string }[]>(token, `/repos/${repo}/deployments/${dep.id}/statuses?per_page=1`);
    const top = st[0]?.state;
    if (!top) return { state: "pending" };
    if (top === "success") return { state: "success", url: st[0].environment_url };
    if (top === "failure" || top === "error") return { state: "failure" };
    return { state: "pending" };
  }
  if (vercel.state === "success") return { state: "success", url: vercel.target_url };
  if (vercel.state === "failure" || vercel.state === "error") return { state: "failure", url: vercel.target_url };
  return { state: "pending", url: vercel.target_url };
}
