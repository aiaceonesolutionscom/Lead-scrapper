import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/* is proxied by the catch-all route handler
  // (src/app/api/[...path]/route.ts), which retries transient 502/503/504
  // failures on the Vercel → Tailscale Funnel hop (flaky 5G NAT) server-side
  // and keeps the session cookie first-party. IMPORTANT: do NOT add a
  // next.config `rewrites()` for /api/:path* — afterFiles rewrites match
  // BEFORE dynamic routes, which would shadow that handler and its retries.
};

export default nextConfig;
