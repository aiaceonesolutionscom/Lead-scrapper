// Rotate flat-file logs under logs/ so they don't grow unbounded on D:.
// Purely a filesystem operation -- does not touch how any part of the app
// writes to these files, so it's safe to run alongside everything else.
// Usage: npm run rotate-logs   (call periodically, e.g. via Task Scheduler)
import { readdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = resolve(__dirname, '..', 'logs');

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // rotate any log file over 5MB
const KEEP_ROTATED = 3; // keep this many rotated copies per log file

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function main() {
  let entries: string[];
  try {
    entries = readdirSync(logsDir);
  } catch {
    console.log('No logs/ directory yet -- nothing to rotate.');
    return;
  }

  const liveLogs = entries.filter((f) => f.endsWith('.log') && !f.includes('.rotated-'));

  for (const file of liveLogs) {
    const fullPath = resolve(logsDir, file);
    const size = statSync(fullPath).size;
    if (size <= MAX_SIZE_BYTES) continue;

    const ext = extname(file);
    const base = basename(file, ext);
    const rotatedPath = resolve(logsDir, `${base}.rotated-${timestamp()}${ext}`);
    renameSync(fullPath, rotatedPath);
    console.log(`Rotated ${file} (${(size / 1024 / 1024).toFixed(1)}MB) -> ${basename(rotatedPath)}`);

    // Prune old rotated copies of this same log, keep the most recent KEEP_ROTATED.
    const rotatedSiblings = readdirSync(logsDir)
      .filter((f) => f.startsWith(`${base}.rotated-`) && f.endsWith(ext))
      .sort()
      .reverse();
    for (const old of rotatedSiblings.slice(KEEP_ROTATED)) {
      unlinkSync(resolve(logsDir, old));
      console.log(`Deleted old rotated log: ${old}`);
    }
  }

  console.log('Log rotation check complete.');
}

main();
