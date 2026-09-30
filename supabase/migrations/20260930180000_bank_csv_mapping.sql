-- Bank CSV import (issue #38, SPEC D30): only the column mapping of the user's bank export is kept.
-- Transactions are read in the browser and never stored.
alter table public.profiles add column bank_csv_mapping jsonb
  check (bank_csv_mapping is null or (jsonb_typeof(bank_csv_mapping) = 'object' and pg_column_size(bank_csv_mapping) < 8192));
