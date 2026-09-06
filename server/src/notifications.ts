import { db, nowIso, randomUUID } from './db';
import type { AppNotification } from '@/types';

/** Create an in-app notification for a user. Silently no-ops on errors so it
    never breaks the search pipeline or a request it is attached to. */
export function createNotification(
  userId: string | null | undefined,
  type: AppNotification['type'],
  title: string,
  body?: string,
  link?: string
): void {
  if (!userId) return;
  try {
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, link, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      randomUUID(),
      userId,
      type,
      String(title).slice(0, 300),
      body ? String(body).slice(0, 1000) : null,
      link ?? null,
      nowIso()
    );
  } catch {
    // notifications are best-effort
  }
}

export function toNotification(row: Record<string, unknown>): AppNotification {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    type: row.type as AppNotification['type'],
    title: String(row.title),
    body: (row.body as string) ?? null,
    link: (row.link as string) ?? null,
    read: Boolean(row.read),
    created_at: String(row.created_at),
  };
}