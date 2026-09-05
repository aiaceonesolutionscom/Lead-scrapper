import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import type { Lead, LeadNote, LeadSource, Search, SearchLead } from '@/types';

/** node:sqlite requires every bound value to be a SQLInputValue; casts the
    dynamic `unknown[]` parameter lists used by the query builders. */
export function sql(values: readonly unknown[]): SQLInputValue[] {
  return values as SQLInputValue[];
}

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

const schema = readFileSync(resolve(config.serverRoot, 'db', 'schema.sql'), 'utf-8');
db.exec(schema);

// Lightweight migration for existing databases: searches.created_by was added
// after the first release. CREATE TABLE IF NOT EXISTS won't add new columns,
// so patch it in when missing. Imported legacy rows stay NULL.
{
  const searchCols = db.prepare('PRAGMA table_info(searches)').all() as { name: string }[];
  if (!searchCols.some((c) => c.name === 'created_by')) {
    db.exec('ALTER TABLE searches ADD COLUMN created_by TEXT REFERENCES users(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_searches_created_by ON searches(created_by)');
}

// users.email — added so accounts can log in with an email address.
// users.password_changed_at — tracks when the password was last changed so
// admins can audit account activity.
{
  const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (!userCols.some((c) => c.name === 'email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  }
  if (!userCols.some((c) => c.name === 'password_changed_at')) {
    db.exec('ALTER TABLE users ADD COLUMN password_changed_at TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
  db.exec('UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL');
}

export { randomUUID };

// ---- Row mappers -------------------------------------------------------------
// SQLite has no BOOLEAN/TIMESTAMPTZ; store 0/1 and ISO-8601 strings and convert
// back to the exact shapes the frontend/API expected from Postgres.

export function toSearch(row: Record<string, unknown>): Search {
  return {
    id: String(row.id),
    keyword: String(row.keyword),
    country: String(row.country),
    city: (row.city as string) ?? null,
    search_mode: row.search_mode as Search['search_mode'],
    requested_count: Number(row.requested_count),
    discovered_count: Number(row.discovered_count ?? 0),
    enriched_count: Number(row.enriched_count ?? 0),
    status: row.status as Search['status'],
    error_message: (row.error_message as string) ?? null,
    created_by: (row.created_by as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function toLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    business_name: String(row.business_name),
    contact_person: (row.contact_person as string) ?? null,
    phone: (row.phone as string) ?? null,
    phone_valid: Boolean(row.phone_valid),
    phone_country: (row.phone_country as string) ?? null,
    email: (row.email as string) ?? null,
    website: (row.website as string) ?? null,
    instagram: (row.instagram as string) ?? null,
    facebook: (row.facebook as string) ?? null,
    linkedin: (row.linkedin as string) ?? null,
    address: (row.address as string) ?? null,
    city: (row.city as string) ?? null,
    country: (row.country as string) ?? null,
    country_code: (row.country_code as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    category: (row.category as string) ?? null,
    status: row.status as Lead['status'],
    notes: (row.notes as string) ?? null,
    confidence: (row.confidence as string) ?? null,
    verified: Boolean(row.verified),
    last_checked: (row.last_checked as string) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function toLeadSource(row: Record<string, unknown>): LeadSource {
  return {
    id: String(row.id),
    lead_id: String(row.lead_id),
    field_name: String(row.field_name),
    field_value: (row.field_value as string) ?? null,
    source: String(row.source),
    confidence: row.confidence as LeadSource['confidence'],
    created_at: String(row.created_at),
  };
}

export function toSearchLead(row: Record<string, unknown>): SearchLead {
  return {
    id: String(row.id),
    search_id: String(row.search_id),
    lead_id: String(row.lead_id),
    discovered_at: String(row.discovered_at),
  };
}

export function toLeadNote(row: Record<string, unknown>): LeadNote {
  return {
    id: String(row.id),
    lead_id: String(row.lead_id),
    note: String(row.note),
    created_at: String(row.created_at),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ---- Shared table helpers ----------------------------------------------------

export function upsertLeadRow(
  lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'>,
  id?: string,
  createdAt?: string
): Lead {
  const leadId = id ?? randomUUID();
  const now = nowIso();
  const createdAtIso = createdAt ?? now;

  db.prepare(
    `INSERT INTO leads (
       id, business_name, contact_person, phone, phone_valid, phone_country,
       email, website, instagram, facebook, linkedin, address, city, country,
       country_code, latitude, longitude, category, status, notes, confidence,
       verified, last_checked, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       business_name = excluded.business_name,
       contact_person = COALESCE(excluded.contact_person, leads.contact_person),
       phone = COALESCE(excluded.phone, leads.phone),
       phone_valid = excluded.phone_valid,
       phone_country = COALESCE(excluded.phone_country, leads.phone_country),
       email = COALESCE(excluded.email, leads.email),
       website = COALESCE(excluded.website, leads.website),
       instagram = COALESCE(excluded.instagram, leads.instagram),
       facebook = COALESCE(excluded.facebook, leads.facebook),
       linkedin = COALESCE(excluded.linkedin, leads.linkedin),
       address = COALESCE(excluded.address, leads.address),
       city = COALESCE(excluded.city, leads.city),
       country = COALESCE(excluded.country, leads.country),
       country_code = COALESCE(excluded.country_code, leads.country_code),
       latitude = COALESCE(excluded.latitude, leads.latitude),
       longitude = COALESCE(excluded.longitude, leads.longitude),
       category = COALESCE(excluded.category, leads.category),
       status = excluded.status,
       notes = COALESCE(excluded.notes, leads.notes),
       confidence = COALESCE(excluded.confidence, leads.confidence),
       verified = excluded.verified,
       last_checked = COALESCE(excluded.last_checked, leads.last_checked),
       updated_at = excluded.updated_at`
  ).run(
    leadId,
    lead.business_name,
    lead.contact_person ?? null,
    lead.phone ?? null,
    lead.phone_valid ? 1 : 0,
    lead.phone_country ?? null,
    lead.email ?? null,
    lead.website ?? null,
    lead.instagram ?? null,
    lead.facebook ?? null,
    lead.linkedin ?? null,
    lead.address ?? null,
    lead.city ?? null,
    lead.country ?? null,
    lead.country_code ?? null,
    lead.latitude ?? null,
    lead.longitude ?? null,
    lead.category ?? null,
    lead.status,
    lead.notes ?? null,
    lead.confidence ?? null,
    lead.verified ? 1 : 0,
    lead.last_checked ?? null,
    createdAtIso,
    now
  );

  return getLeadById(leadId)!;
}

export function getLeadById(id: string): Lead | null {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toLead(row) : null;
}

export function logEvent(component: string, level: 'info' | 'warn' | 'error', message: string): void {
  try {
    db.prepare(
      'INSERT INTO app_events (id, component, level, message, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(randomUUID(), component, level, String(message).slice(0, 4000), nowIso());
  } catch {
    // Logging must never crash the request.
  }
}

export function purgeOldEvents(retentionDays: number): void {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM app_events WHERE created_at < ?').run(cutoff);
  } catch {
    // non-critical
  }
}