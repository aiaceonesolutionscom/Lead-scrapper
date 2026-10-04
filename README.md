# Lead Extractor + CRM

Extract verified business leads from worldwide sources, enrich them, and manage them in a CRM.

## Architecture

```
Browser  →  Next.js frontend  →  local Express backend
localhost:3000                    127.0.0.1:5000
                                  (SQLite + Playwright)
```

- **Frontend** (`src/`): Next.js App Router. Serves the UI and proxies `/api/*`
  to the backend through `src/app/api/[...path]/route.ts`.
- **Backend** (`server/`): Express + SQLite (`node:sqlite`), hosts the headless
  Chrome/Chromium extraction engine via `PLAYWRIGHT_BROWSERS_PATH`. Binds to
  `127.0.0.1` only, so nothing is reachable from the network. Auth +
  brute-force protection + CSRF/origin guard + anti-scrape rate limits are all
  enforced server-side.

Everything runs on one machine. There is no tunnel and no cloud deployment.
To expose the app beyond this PC, put a reverse proxy in front of ports
3000/5000 and add its origin to `ALLOWED_ORIGINS`.

## Security model

- Every `/api/*` data route requires a logged-in session.
- Login rate limiting: per-IP (10 fails) and per-username (6 fails) lock for 15 min.
- Cross-origin (CSRF) guard: only `ALLOWED_ORIGINS` may send state-changing requests.
- Export + logs routes are admin-only; per-IP read throttles limit scraping.
- Server binds to loopback; never exposed directly to the LAN.
- This repository is public, so the database is never committed in plain text.
  `seed/crm.db.enc` is AES-256-GCM encrypted under a scrypt-derived passphrase
  that stays off the machine; `1-INSTALL.bat` asks for it and decrypts into
  `server/data/crm.db`. See `seed/README.md`.

## Setup (local)

Data migrated from the old Supabase backend into the local SQLite DB
(`server/data/crm.db`) — SQLite is now the single source of truth. No Supabase.

The project works from any drive. `scripts\run-backend.cmd` and
`scripts\run-frontend.cmd` set `TMP`/`TEMP`/`NPM_CONFIG_CACHE` under
`.runtime\`, so temp files stay inside the project folder instead of C:.

Run `1-INSTALL.bat` to do all of this automatically. To do it by hand:

```bash
npm ci && npm --prefix server ci     # dependencies
npx playwright install chromium      # fallback browser
npm run create-admin                 # first admin account
npm run build                        # production frontend build
```

`scripts\create-admin.ts` **creates or updates** an account, so running it
against an existing database just resets that user's password — handy when the
seed database already contains accounts.

## Backend

```bash
scripts\run-backend.cmd     # wraps `npm --prefix server run start` (Express on http://127.0.0.1:5000)
```

## Frontend

Runs locally as a production build (`next build` + `next start`); see
**Fast mode vs dev mode** below. Configuration lives in `.env.local`, which
`1-INSTALL.bat` generates from `.env.example`:

| Var | Value |
|-----|-------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://127.0.0.1:5000` — the browser calls the backend directly. Leave it empty to route `/api/*` through the Next.js proxy instead. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | empty disables the captcha; login is still protected by the server-side lockouts |
| `ALLOWED_ORIGINS` | frontends allowed to call the API with cookies |

If you change any `NEXT_PUBLIC_*` value, rebuild before restarting — those
values are inlined into the bundle at build time. `2-START.bat` does this for
you automatically.

## Running locally (full stack)

Three double-clickable files sit in the project root. On a fresh PC:

1. `1-INSTALL.bat` — one time. Installs Node 24 into `.runtime\node` (no admin
   rights needed), installs Chrome if missing, runs `npm ci`, installs the
   Playwright browser, writes `.env.local`, seeds `server\data\crm.db` from
   `seed\crm.db`, creates the admin account, and **builds the production
   frontend**.
2. `2-START.bat` — every time you want to use it. Starts the backend and the
   frontend and opens the browser.
3. `3-STOP.bat` — stops both.

## Fast mode vs dev mode

`2-START.bat` runs the frontend as a **production build** (`next build` +
`next start`). `next dev` recompiles every route the moment you visit it
(3-11s each), which is what makes local use feel slow; a production build is
compiled once, so pages load as fast as a deployed build.

You do not have to rebuild by hand. `scripts\ensure-build.ps1` compares the
newest file under `src\` (plus `next.config.ts`, `package-lock.json` and
`.env.local`) against `.next\BUILD_ID`, and rebuilds only when something
actually changed — about 30-75 seconds when it does, nothing when it doesn't.
`.env.local` is part of that check because `NEXT_PUBLIC_*` values are inlined
into the bundle at build time.

When you are editing code and want changes to appear instantly, use
`2-START-DEV.bat` instead. It is the same script with `APP_MODE=dev`, which
runs `next dev`. The trade-off is the slow on-demand compiling — close it and
go back to `2-START.bat` once you want the fast version again.

Build output, including any failure, is appended to `logs\build.log`. If the
build fails, `2-START.bat` falls back to dev mode automatically so the app
still starts.

The backend needs no build step: it runs straight from TypeScript via `tsx`,
and its time is spent waiting on Playwright and the network, not compiling.

To run the pieces by hand:

```bash
scripts\run-backend.cmd            # backend on 127.0.0.1:5000
scripts\run-frontend.cmd           # frontend, fast mode
set APP_MODE=dev && scripts\run-frontend.cmd   # frontend, dev mode
scripts\stop-all.cmd               # stop both by port
```

## Backups

```bash
npm run backup           # snapshot server/data/crm.db -> backups/backup-YYYY-MM-DD-HH-mm/crm.db
```

Uses SQLite's `VACUUM INTO`, so it's safe to run while the backend is live.
Schedule it (e.g. daily via Windows Task Scheduler) for regular backups.

**Disaster recovery note:** backups are written to `backups\` inside the project
folder. That protects against accidental deletion, but **not** against the
drive failing. Copy the `backups\` folder to a separate physical location or
cloud storage for real disaster recovery.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run start:local` | start backend + frontend, in order |
| `npm run stop:local` | stop both, by port |
| `npm run backend` | start the Express backend |
| `npm run backend:dev` | start backend with auto-reload |
| `npm run dev` / `npm run build` / `npm start` | Next.js dev server / production build / production server |
| `npm run backup` | snapshot the SQLite DB to `backups\` |
| `npm run seed:db` | regenerate `seed\crm.db` from the live database |
| `npm run seed:encrypt` | encrypt `seed\crm.db` into the committed `seed\crm.db.enc` |
| `npm run rotate-logs` | rotate any `logs\*.log` file over 5MB |
| `npm run import:local` / `npm run db:setup` | import a JSON export into SQLite |
| `npm run create-admin` | create/update the first admin |
