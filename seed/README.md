# seed/

A single, consistent snapshot of the CRM database taken with SQLite's
`VACUUM INTO` (see `scripts/make-seed-db.ts`), so a brand-new PC starts with all
the existing leads, searches and user accounts instead of an empty app.

## What is committed, and what is not

| File | In git? | Why |
| --- | --- | --- |
| `crm.db.enc` | yes | the snapshot, encrypted |
| `crm.db` | **no** | the same snapshot in plain text, git-ignored |
| `README.md` | yes | this file |

The snapshot holds real business leads (names, phone numbers, emails,
websites) and bcrypt password hashes, and the GitHub repository this project is
pushed to is **public**. So the database is committed only in encrypted form:

- `AES-256-GCM` seals the file, so a wrong passphrase or a damaged file fails
  loudly instead of producing a corrupt database.
- The key comes from `scrypt` (N=32768, r=8, p=1) over your passphrase, with a
  random 16-byte salt per file, so one leaked file does not help crack another.
- The scrypt parameters and version live in the file header, so the work factor
  can be raised later without breaking existing copies.

Without the passphrase, `crm.db.enc` is opaque: it contains no readable emails,
phone numbers, table names or password hashes.

## Installing on a new PC

Run `1-INSTALL.BAT` as usual. When it reaches the database step it finds
`crm.db.enc`, prints

```
  Seed database password
```

and waits for you. Type the passphrase and press Enter; the database is
decrypted into `server\data\crm.db`. **Press Enter instead to skip it** and
start with an empty database — the install still succeeds either way.

The passphrase is read with `-AsSecureString`, handed to the decrypt step
through a temporary environment variable, and cleared immediately afterwards.
It is never written to disk and never appears on a command line.

## Regenerating it

From a local instance, with the plaintext database in place:

```
npm run seed:db                                        # snapshot -> seed/crm.db
node scripts/encrypt-seed.mjs --generate               # -> seed/crm.db.enc + password
node scripts/encrypt-seed.mjs                          # reuse a password you choose
```

The second command prints the new password **once**. `encrypt-seed.mjs`
decrypts what it just wrote and compares it byte for byte before saving, so a
broken file can never be committed.

Never regenerate while an extraction is mid-flight if you care about the exact
row counts — `VACUUM INTO` takes a point-in-time snapshot.

## Why a snapshot and not a plain copy

The live database runs in WAL mode, and `crm.db-wal` is several megabytes.
Copying `crm.db` on its own would drop every write that had not been
checkpointed yet. `VACUUM INTO` reads the database *and* its WAL together and
writes one compacted, self-contained file, so the seed needs no `-wal` / `-shm`
companions.

## After installing

Because the snapshot already contains user accounts, the server's
bootstrap-admin step is a no-op on a fresh PC. `scripts/install-config.ps1`
therefore runs `scripts/create-admin.ts` afterwards, which *creates or updates*
an account, so the credentials printed at the end of the install always work.

The snapshot ships real accounts, so rotate anything you care about on the new
machine with `npm run create-admin`.

## If the passphrase is lost

There is no recovery path. The seed is only reproducible from the machine that
created it. Keep the password in a password manager.