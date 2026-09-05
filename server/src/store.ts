import { db, getLeadById, nowIso, randomUUID, sql, toLead } from './db';
import { logEvent } from './db';
import type { EnrichedBusiness, ExtractionStore, Lead, Search } from '@/types';

const SEARCH_STATUSES = new Set(['pending', 'discovering', 'enriching', 'completed', 'partially_completed', 'failed', 'cancelled']);

function leadFieldsForUpdate(biz: EnrichedBusiness): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  // Match the original merge semantics: only non-empty values are copied over,
  // so stale/null fields never clobber data already stored for a lead.
  if (biz.phone) updates.phone = biz.phone;
  if (biz.email) updates.email = biz.email;
  if (biz.website) updates.website = biz.website;
  if (biz.instagram) updates.instagram = biz.instagram;
  if (biz.facebook) updates.facebook = biz.facebook;
  if (biz.linkedin) updates.linkedin = biz.linkedin;
  if (biz.contact_person) updates.contact_person = biz.contact_person;
  if (biz.address) updates.address = biz.address;
  if (biz.phone_valid !== undefined) updates.phone_valid = biz.phone_valid ? 1 : 0;
  if (biz.phone_country) updates.phone_country = biz.phone_country;
  if (biz.confidence) updates.confidence = biz.confidence;
  if (biz.verified !== undefined) updates.verified = biz.verified ? 1 : 0;
  if (biz.latitude !== undefined) updates.latitude = biz.latitude ?? null;
  if (biz.longitude !== undefined) updates.longitude = biz.longitude ?? null;
  return updates;
}

function mergeLead(existingId: string, updates: Record<string, unknown>): void {
  const assignments = Object.keys(updates).map((k) => `${k} = ?`);
  if (assignments.length === 0) return;
  const params = [...Object.values(updates)];
  assignments.push('updated_at = ?');
  params.push(nowIso());
  db.prepare(`UPDATE leads SET ${assignments.join(', ')} WHERE id = ?`).run(...sql(params), existingId);
}

/** Local-SQLite implementation of the extraction engine's storage contract. */
export function createExtractionStore(): ExtractionStore {
  return {
    async getStatus(searchId: string): Promise<string> {
      const row = db
        .prepare('SELECT status FROM searches WHERE id = ?')
        .get(searchId) as { status?: string } | undefined;
      return row?.status ?? 'failed';
    },

    async updateSearch(searchId: string, updates: Partial<Search>): Promise<void> {
      const assignments: string[] = [];
      const params: unknown[] = [];
      const knownFields: (keyof Partial<Search>)[] = [
        'status',
        'discovered_count',
        'enriched_count',
        'error_message',
      ];
      for (const field of knownFields) {
        if (updates[field] === undefined) continue;
        if (field === 'status' && !SEARCH_STATUSES.has(updates.status as string)) continue;
        assignments.push(`${field} = ?`);
        params.push(updates[field]);
      }
      if (assignments.length === 0) return;
      assignments.push('updated_at = ?');
      params.push(nowIso());
      db.prepare(`UPDATE searches SET ${assignments.join(', ')} WHERE id = ?`).run(...sql(params), searchId);
    },

    async upsertLead(biz: EnrichedBusiness): Promise<Lead | null> {
      try {
        // Mirrors the original dedup: exact business name + case-insensitive city.
        let existing: Record<string, unknown> | undefined;
        if (biz.city) {
          existing = db
            .prepare('SELECT id FROM leads WHERE business_name = ? AND city = ? COLLATE NOCASE LIMIT 1')
            .get(biz.name, biz.city) as Record<string, unknown> | undefined;
        } else {
          existing = db
            .prepare('SELECT id FROM leads WHERE business_name = ? AND city IS NULL LIMIT 1')
            .get(biz.name) as Record<string, unknown> | undefined;
        }

        if (existing) {
          const updates = leadFieldsForUpdate(biz);
          if (Object.keys(updates).length > 0) {
            mergeLead(String(existing.id), updates);
          }
          return getLeadById(String(existing.id));
        }

        const leadId = randomUUID();
        const now = nowIso();
        db.prepare(
          `INSERT INTO leads (
             id, business_name, contact_person, phone, phone_valid, phone_country,
             email, website, instagram, facebook, linkedin, address, city, country,
             country_code, latitude, longitude, category, status, notes, confidence,
             verified, last_checked, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          leadId,
          biz.name,
          biz.contact_person ?? null,
          biz.phone ?? null,
          biz.phone_valid ? 1 : 0,
          biz.phone_country ?? null,
          biz.email ?? null,
          biz.website ?? null,
          biz.instagram ?? null,
          biz.facebook ?? null,
          biz.linkedin ?? null,
          biz.address ?? null,
          biz.city ?? null,
          biz.country ?? null,
          biz.country_code ?? null,
          biz.latitude ?? null,
          biz.longitude ?? null,
          biz.category ?? null,
          'new',
          null,
          biz.confidence ?? null,
          biz.verified ? 1 : 0,
          null,
          now,
          now
        );

        if (biz.sources) {
          const insertSource = db.prepare(
            'INSERT INTO lead_sources (id, lead_id, field_name, field_value, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          );
          db.prepare('BEGIN').run();
          try {
            for (const [fieldName, meta] of Object.entries(biz.sources)) {
              insertSource.run(
                randomUUID(),
                leadId,
                fieldName,
                meta.value,
                meta.source,
                meta.confidence,
                now
              );
            }
            db.prepare('COMMIT').run();
          } catch (sourceErr) {
            db.prepare('ROLLBACK').run();
            throw sourceErr;
          }
        }

        return getLeadById(leadId);
      } catch (err) {
        logEvent(
          'PLAYWRIGHT',
          'error',
          err instanceof Error ? `Failed to persist lead "${biz.name}": ${err.message}` : `Failed to persist lead "${biz.name}"`
        );
        return null;
      }
    },

    async linkSearchLead(searchId: string, leadId: string): Promise<void> {
      try {
        db.prepare(
          'INSERT OR IGNORE INTO search_leads (id, search_id, lead_id, discovered_at) VALUES (?, ?, ?, ?)'
        ).run(randomUUID(), searchId, leadId, nowIso());
      } catch (err) {
        logEvent(
          'PLAYWRIGHT',
          'warn',
          err instanceof Error ? `Failed to link search_lead: ${err.message}` : 'Failed to link search_lead'
        );
      }
    },
  };
}