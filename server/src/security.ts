import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

/** Hardening headers for every HTTP response. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // API responses must never be cached by shared proxies/caches.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
}

/**
 * CSRF defense. The session cookie is SameSite=None, so a classic form POST
 * from a hostile site could reach the API. Block any cross-origin request
 * whose Origin/Referer is not one of our allowed frontend origins. Requests
 * with no Origin (curl, &c.) pass — they can't carry the browser cookie.
 */
export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const allowed = new Set(config.allowedOrigins);
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    let host: string = String(origin);
    try {
      host = new URL(String(origin)).origin;
    } catch {
      host = String(origin);
    }
    if (!allowed.has(host)) {
      res.status(403).json({ error: 'Cross-origin request blocked' });
      return;
    }
  }
  next();
}

/** Simple in-memory per-IP sliding-window rate limiter (anti-scrape/abuse). */
export function createRateLimiter(name: string, limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      const retryAfter = Math.ceil((windowMs - (now - recent[0])) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      res.status(429).json({ error: `Rate limit exceeded (${name})` });
      return;
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}