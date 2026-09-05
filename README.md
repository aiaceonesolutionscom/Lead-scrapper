# Lead Extractor + CRM

Extract verified business leads from worldwide sources, enrich them, and manage them in a CRM.

## Architecture

```
Vercel (Next.js frontend)  →  Cloudflare Tunnel  →  local Windows laptop backend
                                                      (Express + SQLite + Playwright)
```

- **Frontend** (Vercel): Next.js App Router. Talks to the backend over the tunnel.
- **Backend** (local laptop, `server/`): Express + SQLite (`node:sqlite`), hosts the
  headless Chromium extraction engine via `PLAYWRIGHT_BROWSERS_PATH` on D:.
  Binds to `127.0.0.1` only — the tunnel is the single entry point. Auth + brute-force
  protection + CSRF/origin guard + anti-scrape rate limits are all enforced server-side.

## Security model

- Every `/api/*` data route requires a logged-in session.
- Login rate limiting: per-IP (10 fails) and per-username (6 fails) lock for 15 min.
- Cross-origin (CSRF) guard: only `ALLOWED_ORIGINS` may send state-changing requests.
- Export + logs routes are admin-only; per-IP read throttles limit scraping.
- Server binds to loopback; never exposed directly to the LAN.

## Setup (local)

Data migrated from the old Supabase backend into the local SQLite DB
(`server/data/crm.db`) — SQLite is now the single source of truth. No Supabase.

Everything runs from **D:** only (DB, logs, Chromium, npm cache, temp files):
`scripts\run-backend.cmd` sets `TMP`/`TEMP`/`NPM_CONFIG_CACHE` under
`.runtime\` so nothing touches C:. Use the same pattern for the frontend.

Create the first admin (only if `ADMIN_USERNAME`/`ADMIN_PASSWORD` are not set):

```bash
npm run create-admin        # prompts for username/password, OR:
ADMIN_USERNAME=admin ADMIN_PASSWORD='YourPass123!' npm run create-admin
```

## Backend (local laptop)

```bash
scripts\run-backend.cmd     # D:-runtime wrapper for `npm run backend` (Express on http://127.0.0.1:5000)
```

### Tunnel (Cloudflare)

`cloudflared.exe` is a **portable binary under `tools\`** (downloaded straight
from Cloudflare's GitHub releases) — nothing is installed system-wide or on C:.
`scripts\run-tunnel.cmd` and `npm run tunnel` both call it by that path.

By default it runs a **quick/ephemeral tunnel** (`cloudflared tunnel --url`),
which gets a new random `https://*.trycloudflare.com` URL every restart —
fine for development, but you'd have to update `NEXT_PUBLIC_API_BASE_URL` on
Vercel every time it restarts.

To switch to a **fixed named tunnel** (stable URL forever) once you have a
domain added to your Cloudflare account:

```bash
set "TUNNEL_ORIGIN_CERT=D:\Office work\yawar leads\lead-extractor-crm\.runtime\cloudflared\cert.pem"
tools\cloudflared.exe tunnel login
tools\cloudflared.exe tunnel create leadcrm
# add a DNS CNAME for e.g. api.yourdomain.com -> the tunnel
```

Then fill in `.runtime\cloudflared\config.yml` (see the commented block at
the bottom of `scripts\run-tunnel.cmd` for the exact format), point
`NEXT_PUBLIC_API_BASE_URL` at the new fixed hostname, and switch
`run-tunnel.cmd` from the quick-tunnel line to the named-tunnel line.

## Frontend (Vercel)

Set these environment variables in Vercel:

| Var | Value |
|-----|-------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://leadcrm.yourdomain.com` (your fixed tunnel URL) |
| `NEXT_PUBLIC_APP_URL` | your Vercel app URL |

Add your Vercel URL to the backend's `ALLOWED_ORIGINS` in the laptop's `.env.local`.

## Running locally (full stack)

One command starts everything, in order, each in its own window:

```bash
npm run start:local     # backend -> wait for health -> frontend -> tunnel
npm run stop:local      # stop all three
```

Or individually:

1. `scripts\run-backend.cmd` (terminal 1)
2. `scripts\run-tunnel.cmd` (terminal 2) → copy the `https://*.trycloudflare.com` URL
3. Set `NEXT_PUBLIC_API_BASE_URL` to that URL and `scripts\run-frontend.cmd` (terminal 3)
4. Open http://localhost:3000 and log in

## Backups

```bash
npm run backup           # snapshot server/data/crm.db -> backups/backup-YYYY-MM-DD-HH-mm/crm.db
```

Uses SQLite's `VACUUM INTO`, so it's safe to run while the backend is live.
Schedule it (e.g. daily via Windows Task Scheduler) for regular backups.

**Disaster recovery note:** backups are written to `backups\` on the same D:
drive as everything else. That protects against accidental deletion, but
**not** against the laptop or drive itself failing. Periodically copy the
`backups\` folder to a separate physical location or cloud storage for real
disaster recovery.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run start:local` | start backend + frontend + tunnel, in order |
| `npm run stop:local` | stop all three |
| `npm run backend` | start the Express backend |
| `npm run backend:dev` | start backend with auto-reload |
| `npm run tunnel` | Cloudflare tunnel (portable `tools\cloudflared.exe`) |
| `npm run backup` | snapshot the SQLite DB to `backups\` |
| `npm run rotate-logs` | rotate any `logs\*.log` file over 5MB |
| `npm run import:local` / `npm run db:setup` | import a JSON export into SQLite |
| `npm run create-admin` | create/update the first admin |
