# Versiert Admin (admin.versiert.in)

A private web app for:

1. **Editing every part of versiert.in**: text, images, services, portfolio, testimonials, contact details, social links and form settings, with no code changes.
2. **A SaaS apps directory**: what each of your apps is for, who uses it, and every link (live app, admin, code, hosting, database, notes).

## How it works

- Website content lives in `../content/*.json` in the public `Versiert-Website` repo.
- **Save & publish** commits your change to GitHub, in one commit together with any uploaded images, which go to `public/images/uploads/`. Vercel rebuilds versiert.in automatically. The admin shows "Publishing…" and then "Live", usually within about a minute.
- Images are resized and compressed **in your browser** before upload (WebP, max ~2400 px).
- Every change is a Git commit, so the full history is on GitHub and any change can be reverted there.
- The **SaaS directory** is stored in a separate **private** repo (`SAAS_REPO`). The admin refuses to save it to a public repo.
- If two tabs edit the same section, the second save is blocked instead of overwriting; "Load latest" pulls in the newer version.
- Every save is validated on the server: required fields, link formats (no `javascript:` links), image paths and category names.

## Security

- Sign-in is **GitHub only**, restricted to the usernames in `ADMIN_GITHUB_LOGINS`.
- The session cookie is encrypted (A256GCM, `httpOnly`), so your GitHub token is never readable by the browser. Sessions last 12 hours.
- Every page, API route and save action checks the session. Server actions have built-in CSRF protection.
- The admin is `noindex` and can't be embedded in other sites.
- Never store passwords or API keys in the SaaS notes. Use a password manager.

## One-time setup

### 1. Private repo for the SaaS directory
GitHub → **New repository** → name `versiert-admin-data` → **Private** → tick "Add a README file" → Create.

### 2. GitHub OAuth app (for sign-in)
github.com → Settings → Developer settings → **OAuth Apps** → **New OAuth App**:

| Field | Value |
| --- | --- |
| Application name | Versiert Admin |
| Homepage URL | `https://admin.versiert.in` |
| Authorization callback URL | `https://admin.versiert.in/api/auth/callback` |

Create it, then **Generate a new client secret**.

### 3. Environment variables (Vercel → `versiert-admin` → Settings → Environment Variables)
Add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from step 2, then **Redeploy**. The other variables are already set; see `.env.example`.

### 4. Domain
In GoDaddy DNS add: **CNAME** `admin` → the value Vercel shows under the project's Domains tab.

## Local development

```bash
npm install
```

```bash
CONTENT_BACKEND=local ADMIN_DEV_LOGIN=1 npm run dev
```

Open http://localhost:3100 and use **Dev sign-in**. Local mode reads and writes `../content` and `../public/images` directly (no GitHub). Both flags are ignored in production.

## Adding a new editable field

1. Add it to the JSON in `../content/`.
2. Use it in the website component.
3. Describe it in `lib/schema.ts`. The form and validation update automatically.
