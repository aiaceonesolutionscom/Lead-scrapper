// Create/update an admin (or user) account in the local SQLite backend.
// Usage: npm run create-admin   (interactive)
//    or: ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run create-admin
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dataDir = resolve(repoRoot, 'server', 'data');
const dbPath = resolve(dataDir, 'crm.db');

config({ path: resolve(repoRoot, '.env.local') });

function q(s: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(s, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  let username = process.env.ADMIN_USERNAME || '';
  let password = process.env.ADMIN_PASSWORD || '';

  if (!username) username = (await q('Username: ')).trim();
  if (!password) password = await q('Password (min 8 chars): ');

  if (!username || password.length < 8) {
    console.error('Username required and password must be at least 8 characters.');
    process.exit(1);
  }

  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  const schema = readFileSync(resolve(repoRoot, 'server', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);

  const hashed = await hash(password, 12);
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);

  let id: string;
  let action: string;
  if (existing) {
    id = (existing as { id: string }).id;
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashed, now, id);
    action = 'Updated password for';
  } else {
    id = randomUUID();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, role, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run(id, username, hashed, 'admin', now, now);
    action = 'Created admin';
  }

  console.log(`${action} "${username}"`);
  console.log('Log in at the web app with these credentials.');
}

main().catch((e) => { console.error(e); process.exit(1); });