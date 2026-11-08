# Accessing AI Exam Coach from your MacBook and iPhone

The **Windows PC is the server**: it runs the app, the database and the AI (Ollama). Your MacBook and iPhone only open a web page — they never run a model and nothing is installed on them except (optionally) Tailscale.

**The Windows PC must be switched on, awake and connected to the internet/Wi-Fi** for other devices to reach it. If it is off or asleep, the app on your phone shows *"The Windows host is offline or unreachable"*.
Tip: Windows Settings → System → Power → *When plugged in, put my device to sleep after* → **Never** (or a long time) while you study remotely.

Only the app's port (default **8765**) is ever made reachable. **The Ollama API (11434) is never exposed**, and no router port-forwarding is used.

---

## Mode 1 — Local only (default)

Only the Windows PC can use the app: open **http://127.0.0.1:8765**.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\network.ps1 -Mode local_only
powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
```

---

## Mode 2 — Local network (same Wi-Fi)

Use this at home when the MacBook/iPhone are on the same Wi-Fi as the PC.

On the **Windows PC**:
1. Settings → Network & Internet → Wi-Fi (or Ethernet) → your network → **Network profile type: Private**.
2. Open **PowerShell as Administrator** in the `AIExamCoach` folder and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\network.ps1 -Mode lan
   powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
   ```
   The script asks before creating a Windows Firewall rule named **"AI Exam Coach (LAN)"** that allows TCP 8765 **only** on *Private* networks and **only** from your local subnet. It prints the address to use, e.g. `http://192.168.1.23:8765`.
3. Optional but recommended: give the PC a fixed address in your router (DHCP reservation) so the URL does not change.

On the **MacBook**: open Safari/Chrome → `http://192.168.1.23:8765` → sign in.
On the **iPhone**: Safari → `http://192.168.1.23:8765` → sign in → Share → **Add to Home Screen**.

> LAN traffic is plain HTTP inside your home network. Do not use LAN mode on public/untrusted Wi-Fi (the firewall rule is limited to *Private* networks so it does not apply on networks you marked Public). For encrypted access anywhere, use Tailscale.

---

## Mode 3 — Secure remote access with Tailscale (recommended for anywhere)

[Tailscale](https://tailscale.com/) creates a private, encrypted network (a *tailnet*) between **your own** devices. The app is published only inside your tailnet with **Tailscale Serve** (HTTPS, automatic certificate). It is **not** on the public internet — never use `tailscale funnel` for this app.

The free Personal plan is enough. You sign in with the same account (Google, Microsoft, Apple or GitHub) on every device. Credentials are stored by the Tailscale apps, never in this project.

### 1. Windows PC
1. Download and install Tailscale for Windows: <https://tailscale.com/download/windows>.
2. Click the Tailscale icon in the system tray → **Log in** → sign in with your account. The tray icon shows *Connected*.
3. In the Tailscale admin console (<https://login.tailscale.com/admin/dns>) enable **MagicDNS** and **HTTPS Certificates** (one-time; needed for `https://…ts.net`).
4. Optional: in the admin console → Machines → your PC → **Disable key expiry**, so the server does not drop off the tailnet every few months.
5. In PowerShell in the `AIExamCoach` folder:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\network.ps1 -Mode tailscale
   powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
   ```
   After your confirmation this runs `tailscale serve --bg --https=443 http://127.0.0.1:8765`. The app itself keeps listening on `127.0.0.1` only; Tailscale terminates HTTPS and forwards to it. The script prints your address, e.g. **https://my-desktop.tail1234.ts.net**.

### 2. MacBook
1. Install Tailscale from the Mac App Store or <https://tailscale.com/download/mac>.
2. Open it from the menu bar → **Log in** with the **same account**.
3. Open **https://my-desktop.tail1234.ts.net** in Safari/Chrome → sign in to Exam Coach.

### 3. iPhone
1. Install **Tailscale** from the App Store (<https://apps.apple.com/app/tailscale/id1470499037>).
2. Open it → **Log in** with the same account → allow the VPN configuration → toggle **Connected**.
3. Safari → **https://my-desktop.tail1234.ts.net** → sign in.
4. Share → **Add to Home Screen** for an app-like icon. The *Photograph handwriting* button on *Answer Evaluation* opens the iPhone camera.

Remember: Tailscale must be **connected** on the phone/Mac, and the PC must be on.

### Undo
```powershell
powershell -ExecutionPolicy Bypass -File scripts\network.ps1 -Mode local_only
```
removes the Tailscale Serve mapping for this app (only this app's mapping) and/or the LAN firewall rule.

---

## Security checklist
- [x] App requires login on every device (sessions expire; *Settings* shows recent sign-ins in the audit log).
- [x] Ollama bound to `127.0.0.1:11434` (`OLLAMA_HOST`), never forwarded or served.
- [x] No router port forwarding; no Tailscale Funnel.
- [x] LAN rule restricted to Private profile + local subnet; removed when switching mode.
- [x] Use a strong, unique password for the app (and for your Tailscale identity provider account).
