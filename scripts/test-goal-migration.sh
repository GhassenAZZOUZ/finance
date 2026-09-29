#!/usr/bin/env bash
# Runs supabase/tests/unify_goals_migration.sql against the LOCAL Supabase database (docker), which
# must be at the migration just before 20260930090000. The test rolls everything back.
set -euo pipefail
cd "$(dirname "$0")/.."
container="${SUPABASE_DB_CONTAINER:-supabase_db_finance}"
docker exec "$container" rm -rf /tmp/supabase-check
docker cp supabase "$container:/tmp/supabase-check"
docker exec "$container" psql -U postgres -d postgres -q -P pager=off -P tuples_only=on -f /tmp/supabase-check/tests/unify_goals_migration.sql
docker exec "$container" rm -rf /tmp/supabase-check
