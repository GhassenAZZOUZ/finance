# Hosted migrations

How schema changes reach the hosted Supabase project, and what to do when one goes wrong
(issue #101).

## How a migration ships

1. **Pull request**: the `migrations-preview` job (« Hosted migrations (dry-run) ») runs
   `supabase db push --linked --dry-run` and lists, in the run summary, the migrations that would be
   applied once merged. It applies nothing. It also flags destructive statements.
2. **Merge to `main`**: once the checks, integration and E2E tests pass, `migrate-plan` lists the
   migrations missing from the hosted history and scans them with
   [`scripts/destructive-sql.mjs`](../scripts/destructive-sql.mjs).
3. **Destructive migration only**: `migrate-approval` waits on the protected environment
   `hosted-db-destructive` until the owner approves it (Actions › the run › « Review deployments »).
   Rejecting it stops the run: nothing is applied, nothing is deployed.
4. `migrate` runs `supabase db push`, then `deploy` publishes the site.

**Destructive** means: `DROP` (table, column, function, policy, index…), `ALTER … RENAME`,
`ALTER … DROP` (except `DROP NOT NULL` / `DROP DEFAULT`, which lose no data), `TRUNCATE`, and
`DELETE` / `UPDATE` without `WHERE`. Comments and string literals are ignored; statements inside
function bodies count.

Never apply a migration by hand on the hosted project, never edit a migration that has been applied,
and never run `supabase db reset` against it.

## When the migration succeeded but the deploy failed

The database is then **ahead of the code**: the site still runs the previous version against the new
schema.

1. **Check what failed.** Open the run: `migrate` is green, `deploy` is red. Read the deploy log.
2. **Is the live site still working?** Sign in and open the dashboard, Budget and Suivi.
   - Most migrations only add (tables, columns with a default, functions): the old code keeps
     working. Fix the deploy and re-run the `deploy` job (« Re-run failed jobs »), or push the fix
     to `main`. Nothing to do on the database.
3. **The old code breaks on the new schema** (a renamed or dropped column, a changed function
   signature): roll forward.
   - Write a **new** migration that restores what the live code needs (re-add the column, a view
     with the old name, the old function signature as a wrapper), merge it, and let CI apply it.
   - Then fix the deploy. Remove the compatibility migration later, in its own PR, once the new
     code is live.
4. **A migration applied only partly** (it failed half-way: Postgres runs each file in a
   transaction, so this should not happen): compare with `supabase migration list --linked`.
   Repair the history with `supabase migration repair --linked --status reverted <version>` only
   for a version whose changes are really absent, then let CI push it again.
5. **Data was lost** by a destructive migration: restore from the weekly backup, see
   [BACKUPS.md](BACKUPS.md). Restore into a new project first and copy only what is missing.

Write down what happened in the PR that caused it.
