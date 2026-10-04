// Shared helpers for the encrypted seed database (seed/crm.db.enc).
//
// The seed holds real business leads and real user accounts, so it must never
// sit in the public repository in plain form. It is stored as
//
//   "CRMSEED" | version | N | r | p | salt(16) | iv(12) | tag(16) | ciphertext
//
// with the key derived from a passphrase using scrypt and the payload sealed
// with AES-256-GCM. GCM's authentication tag means a wrong passphrase or a
// damaged file fails loudly on decrypt instead of producing a corrupt
// database.
//
// scrypt parameters (N/r/p) are stored in the header so a future version can
// raise the work factor and still read older files.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Must be exactly 8 bytes: the header layout below reserves 8 for it, and a
// shorter string would silently leave a NUL byte that fails the magic check on
// read-back.
export const SEED_MAGIC = 'SEEDDB01';
export const SEED_VERSION = 1;

// Header layout, single source of truth for both directions.
const OFF_MAGIC = 0;
const OFF_VERSION = 8;
const OFF_SCRYPT = 9; // N, r, p as three uint32LE = 12 bytes
const OFF_SALT = 21;
const OFF_IV = 37;
const OFF_TAG = 49;
const HEADER_SIZE = OFF_TAG + 16;

// ~64 MB of memory and roughly 0.3s on a normal laptop: slow enough to make
// offline guessing of a leaked file expensive, fast enough for a one-off
// install step.
export const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };

export function deriveKey(passphrase, salt, params = SCRYPT) {
  return scryptSync(passphrase.normalize('NFKC'), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    // scrypt needs maxmem > 128 * N * r; the default 32 MB is below that.
    maxmem: 256 * 1024 * 1024,
  });
}

export function encryptSeed(plaintext, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = Buffer.alloc(HEADER_SIZE);
  // write() takes (string, offset, length, encoding) - the encoding is the
  // fourth argument, so it has to be spelled out here.
  header.write(SEED_MAGIC, OFF_MAGIC, SEED_MAGIC.length, 'ascii');
  header.writeUInt8(SEED_VERSION, OFF_VERSION);
  header.writeUInt32LE(SCRYPT.N, OFF_SCRYPT);
  header.writeUInt32LE(SCRYPT.r, OFF_SCRYPT + 4);
  header.writeUInt32LE(SCRYPT.p, OFF_SCRYPT + 8);
  salt.copy(header, OFF_SALT);
  iv.copy(header, OFF_IV);
  cipher.getAuthTag().copy(header, OFF_TAG);
  return Buffer.concat([header, ciphertext]);
}

export function decryptSeed(blob, passphrase) {
  if (blob.length < HEADER_SIZE) throw new Error('file is too short to be a seed database');
  if (blob.subarray(OFF_MAGIC, OFF_MAGIC + SEED_MAGIC.length).toString('ascii') !== SEED_MAGIC) {
    throw new Error('not a seed database file (bad magic)');
  }
  const version = blob.readUInt8(OFF_VERSION);
  if (version !== SEED_VERSION) throw new Error(`unsupported seed file version ${version}`);
  const params = {
    N: blob.readUInt32LE(OFF_SCRYPT),
    r: blob.readUInt32LE(OFF_SCRYPT + 4),
    p: blob.readUInt32LE(OFF_SCRYPT + 8),
    keylen: 32,
  };
  const salt = blob.subarray(OFF_SALT, OFF_IV);
  const iv = blob.subarray(OFF_IV, OFF_TAG);
  const tag = blob.subarray(OFF_TAG, HEADER_SIZE);
  const key = deriveKey(passphrase, salt, params);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(HEADER_SIZE)), decipher.final()]);
  } catch {
    throw new Error('wrong password, or the file has been modified');
  }
}

// A decrypted blob is only useful if SQLite can actually read it, so verify
// the header and run a trivial query before writing anything to disk.
export function looksLikeSqlite(buffer) {
  return buffer.length > 100 && buffer.subarray(0, 15).toString('ascii') === 'SQLite format 3';
}