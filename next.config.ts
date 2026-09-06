import type { NextConfig } from "next";

// The API is reachable two ways:
// 1. Local dev: NEXT_PUBLIC_API_BASE_URL=http://localhost:5000 → direct calls.
// 2. Production (Vercel): NEXT_PUBLIC_API_BASE_URL is EMPTY, so the client
//    calls SAME-ORIGIN `/api/*` on the Vercel domain. This rewrite proxies
//    those requests to the backend (Cloudflare tunnel) so the session cookie
//    stays FIRST-PARTY (vercel.app). Why it matters: the login cookie is
//    SameSite=None; in production the client used to call the tunnel domain
//    directly, making it a third-party cookie which desktop browsers accept
//    but MOBILE browsers (Safari/Chrome) block → login silently failed there.
//    With a same-origin proxy the cookie is issued for vercel.app → works on
//    all browsers/devices.
const nextConfig: NextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV === "development") return [];
    const target = process.env.API_PROXY_TARGET || "http://localhost:5000";
    return [
      {
        source: "/api/:path*",
        destination: `${target}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
