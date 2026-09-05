import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'extraction.log');

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

export function logExtraction(searchId: string, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const timestamp = new Date().toISOString();
  const shortId = searchId.slice(0, 8);
  const line = `[${timestamp}] [${shortId}] [${level.toUpperCase()}] ${message}\n`;
  
  try {
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // Non-critical — don't crash extraction over logging
  }
  
  // Also log to console
  const prefix = `[Extraction][${shortId}]`;
  if (level === 'error') console.error(prefix, message);
  else if (level === 'warn') console.warn(prefix, message);
  else console.log(prefix, message);
}
