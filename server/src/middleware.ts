import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from './config';
import { getUserFromSession, type AppUser } from './auth';

export interface AppRequest extends Request {
  user?: AppUser;
}

export type AppResponse = Response;

/** Wraps an async route handler so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: AppRequest, res: AppResponse, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AppRequest, res, next)).catch(next);
  };
}

export function sendError(res: AppResponse, status: number, error: string, details?: unknown): void {
  res.status(status).json(details !== undefined ? { error, details } : { error });
}

/** CORS for cross-origin cookies: echo allowed origins only, never `*`. */
export function corsMiddleware(req: AppRequest, res: AppResponse, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
}

function requireAuthUnsafe(req: AppRequest, res: AppResponse, requireAdmin: boolean): boolean {
  const sid = (req.cookies?.[config.sessionCookieName] as string) || '';
  const user = getUserFromSession(sid);
  if (!user) {
    sendError(res, 401, 'Not authenticated');
    return false;
  }
  if (requireAdmin && user.role !== 'admin') {
    sendError(res, 403, 'Admin privileges required');
    return false;
  }
  req.user = user;
  return true;
}

export function requireAuth(req: AppRequest, res: AppResponse, next: NextFunction): void {
  if (requireAuthUnsafe(req, res, false)) next();
}

export function requireAdmin(req: AppRequest, res: AppResponse, next: NextFunction): void {
  if (requireAuthUnsafe(req, res, true)) next();
}

/** Returns the authenticated user (or null) without failing the request. */
export function getOptionalUser(req: AppRequest): AppUser | null {
  const sid = (req.cookies?.[config.sessionCookieName] as string) || '';
  return getUserFromSession(sid);
}