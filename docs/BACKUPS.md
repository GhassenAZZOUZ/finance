# Database backups

`.github/workflows/backup.yml` runs every Sunday at 03:41 UTC, and by hand from **Actions → Back up the
database → Run workflow**. It dumps the hosted database (roles, schema, and the `public` and `auth` data)
and encrypts the dump with [age](https://age-encryption.org) for the owner's public key. It then commits
`YYYY/finance-YYYY-MM-DD.tar.gz.age` to a **private** repository. The plain dump only ever exists in the
runner's temp directory. Without the private key, a backup can't be read, not even by someone with
access to the backup repository.

## Setup (once)

1. **Private key**: `age-keygen -o age-key.txt` on the owner's machine (already done; never commit it).
   Keep it in a password manager and delete the file. **If this key is lost, every backup is
   unreadable.**
2. **Backup repository**: create a private repository, e.g. `GhassenAZZOUZ/finance-backups`.
3. **Deploy key**: `ssh-keygen -t ed25519 -N "" -f backup_deploy_key`. Add `backup_deploy_key.pub` to the
   backup repository (Settings → Deploy keys, **Allow write access**). Put the content of
   `backup_deploy_key` in this repository's **secret** `BACKUP_DEPLOY_KEY`, then delete both local files.
4. This repository's **variables**:
   - `BACKUP_AGE_PUBLIC_KEY` = `age1lexc2eat7yumm2mk3kp43yqpmr75gxllg0prp8xjesc0u9mz2acqhpvs44`
     (the `# public key:` line of the key file)
   - `BACKUP_REPOSITORY` = `GhassenAZZOUZ/finance-backups`
5. Run the workflow by hand once and check that a `.age` file appears in the backup repository.

`SUPABASE_ACCESS_TOKEN` (already used by the `migrate` job) is enough to dump: no database password.

## Restore

```sh
age -d -i age-key.txt finance-YYYY-MM-DD.tar.gz.age | tar -xz   # roles.sql, schema.sql, data.sql
psql "$TARGET_DB_URL" -f roles.sql -f schema.sql
psql "$TARGET_DB_URL" -c "set session_replication_role = replica" -f data.sql   # triggers off while loading
```

Try it against the local stack first (`npx supabase start`, `TARGET_DB_URL` =
`postgresql://postgres:postgres@127.0.0.1:55322/postgres` after `supabase db reset`). Only then restore
into a new hosted project.
