# Deployment & domain guide — versiert.in

> **Rule for this whole guide:** nothing irreversible happens without your explicit go-ahead. The current live site stays online until the new one is verified.

---

## 1. What I found (read-only checks, 5 Nov 2026)

| Item | Finding |
| --- | --- |
| Your Vercel account | `abhiramjayan-versiert`, team **Versiert Solutions** (`versiert-solutions`), plan **Hobby** |
| Domains in your Vercel team | **None.** `versiert.in` is *not* in your account. |
| Projects in your team | `finance-os`, `event-app`, `vapp` (none are this website) |
| `versiert.in` nameservers | `ns05.domaincontrol.com`, `ns06.domaincontrol.com`, i.e. **GoDaddy DNS** |
| `versiert.in` A record | `216.198.79.1` (a Vercel IP), so it's served by a Vercel project (your friend's) |
| `www.versiert.in` | CNAME → `ac54522f447ebc1a.vercel-dns-017.com` (project-specific Vercel target) |
| `verisert.in` (spelling in the email address) | Only the `.in` registry's default nameservers; no records. **Likely not registered.** |

**Conclusion:** `versiert.in` is registered and DNS-hosted outside Vercel (DNS at GoDaddy) and is only attached to a project in your friend's Vercel account. That is the [**claim domain ownership**](https://vercel.com/docs/domains/claiming-domain-ownership) case: verify with a TXT record, then reassign. It is **not** a Vercel-to-Vercel *domain Move*. No registrar transfer and no nameserver change are needed.

> ⚠️ Confirm in your GoDaddy account that the domain is registered in your name and that GoDaddy is where you manage DNS. The nameservers strongly suggest so, but the registrar of record can differ from the DNS host. If you see the domain listed in GoDaddy → My Products → Domains, the steps below apply exactly.

---

## 2. Choose a hosting plan (commercial use)

Vercel's **Hobby plan is for personal, non-commercial use only** (Vercel Fair Use Guidelines). A company website is commercial, so **don't deploy this site on Hobby.** Options:

| Option | Cost | Notes |
| --- | --- | --- |
| **A. Vercel Pro** (upgrade your `versiert-solutions` team) | Paid per seat per month; check current pricing at vercel.com/pricing | Keeps everything in Vercel, with preview deploys and analytics. |
| **B. Cloudflare Pages** (free plan) | Free | Its free plan allows commercial sites. This project is a pure static export, so it fits perfectly. |

I couldn't open vercel.com from the build environment (network restricted), so read the current Hobby/Pro terms on vercel.com/pricing and vercel.com/docs/limits/fair-use-guidelines before upgrading. **Upgrading to Pro is a billing action that you must approve and perform yourself.**

Both options are covered below.

---

## 3. Pre-flight: record your current DNS (do this first)

In **GoDaddy → My Products → versiert.in → DNS**, screenshot or export **every** record before touching anything. Note especially:

- **MX** records (email delivery). **Never delete these.**
- **TXT** records (SPF `v=spf1…`, DKIM, DMARC `_dmarc`, Google/Microsoft verification). **Keep all of them.**
- **CNAME** records used by email providers (e.g. `autodiscover`, `selector1._domainkey`). Keep them.
- The current `A @ → 216.198.79.1` and `CNAME www → …vercel-dns-017.com`. These are the only two that will change.

---

## 4A. Deploy on Vercel Pro (your account)

### Step 1: push the code to GitHub
This code is on GitHub at `abhiramjayan-versiert/versiert-website`, branch `claude/versiert-media-website-xqhnbl`. Merge it into your main branch once you approve the design.

### Step 2: upgrade the team to Pro (you, in the dashboard)
Vercel → team **Versiert Solutions** → Settings → Billing → Upgrade to Pro.

### Step 3: create the project
Vercel → Add New → Project → import `versiert-website`. Settings:
- Framework preset: **Next.js** (auto-detected)
- Build command: `next build` (default), output: auto (the static export is detected)
- Environment variables: `NEXT_PUBLIC_SITE_URL=https://versiert.in` (optional: `NEXT_PUBLIC_WEB3FORMS_KEY` or `NEXT_PUBLIC_FORM_ENDPOINT`)

Deploy. Check the generated `*.vercel.app` URL thoroughly. **The live versiert.in is untouched at this point.**

### Step 4: claim the domain from your friend's project
1. In your new project → Settings → **Domains** → add `versiert.in` (and `www.versiert.in`).
2. Because the domain is in use by another Vercel account, Vercel shows **"Domain is already in use"** with a **TXT verification record**, for example:

   | Type | Name | Value |
   | --- | --- | --- |
   | TXT | `_vercel` | `vc-domain-verify=versiert.in,xxxxxxxxxxxx` |

3. In **GoDaddy DNS**, **add** that TXT record. *Add only; don't edit or delete anything else.*
4. Back in Vercel, click **Verify** (or **Refresh**). When verified, Vercel assigns the domain to **your** project and removes it from your friend's project automatically.
5. Vercel then shows the DNS values it wants. If they differ from the existing ones, update only these two records in GoDaddy:
   - `A  @   → <IP shown by Vercel>` (Vercel currently recommends `76.76.21.21`; the existing `216.198.79.1` is also a Vercel address)
   - `CNAME www → <value shown by Vercel>` (e.g. `cname.vercel-dns.com`)
6. Wait for the green "Valid Configuration" tick and SSL certificate (usually minutes). Choose which host redirects to which (e.g. `www → versiert.in`).

**Downtime:** almost none. The records already point at Vercel; the TXT claim only changes which project answers.

### Step 5: tidy up (after the new site is live and verified)
- Ask your friend to confirm the domain no longer appears in their project's Domains list. If it still does, they remove it (Project → Settings → Domains → Remove). **Not** "Delete project" unless they want to.
- The `_vercel` TXT record can stay; it's harmless.
- If the friend's project has a **custom domain redirect** or any **Vercel DNS** zone for versiert.in (it shouldn't, since DNS is at GoDaddy), they remove it after the switch.

---

## 4B. Deploy on Cloudflare Pages (free, commercial use allowed)

This keeps your DNS at GoDaddy; **no nameserver change is required.**

1. Cloudflare dashboard → Workers & Pages → Create → Pages → **Connect to Git** → select `versiert-website`.
2. Build settings:
   - Framework preset: **Next.js (Static HTML Export)**
   - Build command: `npm run build`
   - Output directory: `out`
   - Environment variable: `NODE_VERSION=22`, `NEXT_PUBLIC_SITE_URL=https://versiert.in`
3. Deploy, then test the `*.pages.dev` URL.
4. Pages project → **Custom domains** → add `www.versiert.in`. Cloudflare shows a CNAME target (`<project>.pages.dev`). In GoDaddy, **change** `CNAME www` to that target.
5. Apex domain (`versiert.in`): Cloudflare Pages only supports apex domains when the zone is on Cloudflare nameservers. Two choices:
   - **Keep GoDaddy DNS (simplest):** use GoDaddy's *Forwarding* to send `versiert.in` → `https://www.versiert.in` (301), and make `www` the canonical host (`NEXT_PUBLIC_SITE_URL=https://www.versiert.in`).
   - **Move DNS to Cloudflare:** only with your approval, and only after copying **every** existing record (MX/TXT/CNAME) into Cloudflare and checking them. Then change nameservers at GoDaddy. This is a significant change and would be done carefully as a separate step.
6. **Release the domain from your friend's Vercel project:** once DNS points to Cloudflare, ask your friend to remove `versiert.in` and `www.versiert.in` from their project's Domains settings.

---

## 5. What I will NOT do without your approval

- Upgrade any plan or create billing.
- Add, change or delete any DNS record.
- Add the domain to a project or trigger the ownership claim (that moves the live domain).
- Change nameservers, purchase domains, or start a registrar transfer.

When you're ready, tell me which option (4A or 4B) you want, and I'll walk through each step with you, verifying as we go.

---

## Reference: official docs

- Claim domain ownership: https://vercel.com/docs/domains/claiming-domain-ownership
- Set up a custom domain: https://vercel.com/docs/domains/set-up-custom-domain
- Move or transfer a domain (only relevant if a domain is *registered* with Vercel): https://vercel.com/docs/domains/working-with-domains/transfer-your-domain. For Vercel-registered domains, the owner runs `vercel domains move <domain> <team-slug>`, which preserves DNS records but not project assignments. That doesn't apply to versiert.in, which is registered externally.
