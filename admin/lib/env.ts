import "server-only";

const isProd = process.env.NODE_ENV === "production";

export const env = {
  isProd,
  /** "local" only allowed outside production. */
  backend: (!isProd && process.env.CONTENT_BACKEND === "local" ? "local" : "github") as "local" | "github",
  devLogin: !isProd && process.env.ADMIN_DEV_LOGIN === "1" && process.env.CONTENT_BACKEND === "local",
  githubClientId: process.env.GITHUB_CLIENT_ID || "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  allowedLogins: (process.env.ADMIN_GITHUB_LOGINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  repo: process.env.GITHUB_REPO || "Abhiramjayan-versiert/Versiert-Website",
  branch: process.env.GITHUB_BRANCH || "main",
  saasRepo: process.env.SAAS_REPO || "",
  saasPath: process.env.SAAS_PATH || "saas-apps.json",
  siteUrl: (process.env.SITE_URL || "https://versiert.in").replace(/\/$/, ""),
};
