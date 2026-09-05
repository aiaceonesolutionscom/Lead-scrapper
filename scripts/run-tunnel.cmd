@echo off
rem ============================================================
rem  Cloudflare Tunnel — quick/ephemeral URL (active mode)
rem  Uses the portable cloudflared.exe under tools\ (D:) --
rem  nothing installed system-wide, nothing on C:.
rem ============================================================
set "RT=D:\Office work\yawar leads\lead-extractor-crm\.runtime"
set "TMP=%RT%\tmp"
set "TEMP=%RT%\tmp"
set "HTTPS_PROXY="
set "HTTP_PROXY="
if not exist "%TMP%" mkdir "%TMP%"

set "CLOUDFLARED=D:\Office work\yawar leads\lead-extractor-crm\tools\cloudflared.exe"

"%CLOUDFLARED%" tunnel --url http://127.0.0.1:5000

rem ============================================================
rem  FIXED / NAMED TUNNEL (inactive until a domain is added to
rem  Cloudflare — see README "Cloudflare Tunnel" section).
rem
rem  One-time setup once you have a domain on Cloudflare:
rem    1) set "TUNNEL_ORIGIN_CERT=%RT%\cloudflared\cert.pem"
rem       (keeps the login cert on D:, not C:\Users\...\.cloudflared)
rem    2) "%CLOUDFLARED%" tunnel login
rem    3) "%CLOUDFLARED%" tunnel create leadcrm
rem    4) Add a DNS CNAME for e.g. api.yourdomain.com -> the tunnel
rem    5) Create %RT%\cloudflared\config.yml:
rem         tunnel: leadcrm
rem         credentials-file: %RT%\cloudflared\<tunnel-id>.json
rem         ingress:
rem           - hostname: api.yourdomain.com
rem             service: http://127.0.0.1:5000
rem           - service: http_status:404
rem    6) Point NEXT_PUBLIC_API_BASE_URL (Vercel env var) at
rem       https://api.yourdomain.com
rem    7) Comment out the quick-tunnel line above and uncomment
rem       the line below.
rem ============================================================
rem "%CLOUDFLARED%" tunnel --config "%RT%\cloudflared\config.yml" run leadcrm
