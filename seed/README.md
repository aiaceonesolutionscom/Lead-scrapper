# seed/crm.db

A single, consistent snapshot of the CRM database taken with SQLite's
`VACUUM INTO` (see `scripts/make-seed-db.ts`), so a brand-new PC starts with
all the existing leads, searches and user accounts instead of an empty app.

## It is not in git, on purpose

`crm.db` holds real business leads (names, phone numbers, emails, websites)
and bcrypt password hashes, and the GitHub repository this project is pushed
to is **public**. Committing it would publish that data, so `.gitignore` keeps
`seed/crm.db` out of the repository.

To set up a new PC, put `crm.db` into this `seed\` folder before running
`1-INSTALL.BAT` (transfer it however you like, or use an encrypted archive).
Without it the install still succeeds — you just start with an empty database
and only the freshly created admin account.

## Why a snapshot and not a plain copy

The live database runs in WAL mode, and `crm.db-wal` is several megabytes.
Copying `crm.db` on its own would drop every write that had not been
checkpointed yet. `VACUUM INTO` reads the database *and* its WAL together and
writes one compacted, self-contained file, so the seed needs no `-wal` / `-shm`
companions.

## How it is installed

`1-INSTALL.BAT` copies this file to `server\data\crm.db` **only if no database
exists yet**. Re-running the installer therefore never overwrites live data.

Because the snapshot already contains user accounts, the server's
bootstrap-admin step is a no-op on a fresh PC. `scripts/install-config.ps1`
therefore runs `scripts/create-admin.ts` afterwards, which *creates or updates*
an account, so the credentials printed at the end of the install always work.

## Refreshing it

Regenerate from a running (or stopped) local instance with:

```
npm run seed:db
```

Never regenerate while an extraction is mid-flight if you care about the exact
row counts — `VACUUM INTO` takes a point-in-time snapshot.

## Contents

`crm.db` holds real business data and bcrypt password hashes, so keep this
repository private. Rotate the admin password with `npm run create-admin` after
installing on a new machine.
