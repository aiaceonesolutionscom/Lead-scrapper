import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { compare, hash, hashSync } from 'bcryptjs';
import { db, nowIso } from './db';
import { config } from './config';
import { isStrongPassword } from './password-policy';

export interface AppUser {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  enabled: boolean;
  onboarding_seen: boolean;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toAppUser(row: object): AppUser {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    username: String(r.username),
    email: (r.email as string) ?? null,
    role: r.role as AppUser['role'],
    enabled: Boolean(r.enabled),
    onboarding_seen: Boolean(r.onboarding_seen),
    password_changed_at: (r.password_changed_at as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function verifyPassword(password: string, hashValue: string): Promise<boolean> {
  return compare(password, hashValue);
}

export function getUserByUsername(username: string): AppUser | null {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as Record<string, unknown> | undefined;
  return row ? toAppUser(row) : null;
}

export function getUserByLogin(identifier: string): AppUser | null {
  const row = db
    .prepare(
      'SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE'
    )
    .get(identifier, identifier) as Record<string, unknown> | undefined;
  return row ? toAppUser(row) : null;
}

export function getUserById(id: string): AppUser | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toAppUser(row) : null;
}

export function createUser(
  username: string,
  passwordHash: string,
  role: 'admin' | 'user',
  email: string | null = null
): AppUser {
  const now = nowIso();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO users (id, username, email, password_hash, password_changed_at, role, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
  ).run(id, username, email, passwordHash, now, role, now, now);
  return getUserById(id)!;
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  return Number(row.c);
}

function deleteSessionRow(sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function createSession(userId: string): { id: string; expiresAt: string } {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    expiresAt,
    nowIso()
  );
  return { id, expiresAt };
}

export function destroySession(sessionId: string): void {
  if (sessionId) deleteSessionRow(sessionId);
}

export function getUserFromSession(sessionId: string): AppUser | null {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.enabled = 1`
    )
    .get(sessionId, nowIso()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return toAppUser(row);
}

export function cleanupExpiredSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

export function setSessionCookie(res: Response, sid: string): void {
  res.cookie(config.sessionCookieName, sid, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
  });
}

export function createBootstrapAdminIfNeeded(): void {
  if (countUsers() > 0) return;
  const username = config.adminUsername.trim();
  const password = config.adminPassword;
  if (!username || !password) return;
  if (!isStrongPassword(password)) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters with uppercase, lowercase, digit, and special character');
  }
  // Synchronous hash so the admin exists before the first login can arrive
  // (the listen callback may return before an async hash resolves).
  createUser(username, hashSync(password, 12), 'admin');
  console.log(`Created bootstrap admin "${username}"`);
}