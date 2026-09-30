-- Bank CSV import, part (b) (issue #63, SPEC D31): keyword rules learnt from the confirmed
-- assignments, and each imported month's actual total per budget line. Still no transaction stored.

create table public.bank_csv_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Normalised label fragment (upper case, no accents or digits): « CARREFOUR MARKET ».
  keyword text not null check (char_length(keyword) between 1 and 100),
  -- The budget line it goes to; null = « Ignoré ».
  budget_line_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, keyword),
  -- A rule for a deleted line goes with it.
  foreign key (budget_line_id, user_id) references public.budget_lines (id, user_id) on delete cascade
);

create table public.bank_line_totals (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month public.year_month not null,
  budget_line_id uuid not null,
  -- Income received, or money spent (a refund lowers it, so it may be negative).
  actual numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, month, budget_line_id),
  foreign key (budget_line_id, user_id) references public.budget_lines (id, user_id) on delete cascade
);

create trigger bank_csv_rules_set_updated_at before update on public.bank_csv_rules
  for each row execute function public.set_updated_at();

alter table public.bank_csv_rules enable row level security;
alter table public.bank_line_totals enable row level security;
revoke all on public.bank_csv_rules, public.bank_line_totals from anon;
grant select, insert, update, delete on public.bank_csv_rules, public.bank_line_totals to authenticated;
grant all on public.bank_csv_rules, public.bank_line_totals to service_role;
revoke truncate, references, trigger on public.bank_csv_rules, public.bank_line_totals from authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['bank_csv_rules', 'bank_line_totals'] loop
    execute format('create policy "%1$s_select_own" on public.%1$I for select to authenticated
      using (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_insert_own" on public.%1$I for insert to authenticated
      with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_update_own" on public.%1$I for update to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_delete_own" on public.%1$I for delete to authenticated
      using (user_id = (select auth.uid()))', t);
  end loop;
end
$$;

-- One import, all-or-nothing: the month's per-line totals are replaced (a re-import never adds to
-- them) and the learnt rules are upserted by keyword. Security invoker: RLS applies.
create function public.save_bank_import(p_month public.year_month, p_totals jsonb, p_rules jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_totals) is distinct from 'array' or jsonb_typeof(p_rules) is distinct from 'array' then
    raise exception 'save_bank_import: invalid payload' using errcode = '22023';
  end if;

  delete from public.bank_line_totals t where t.month = p_month;
  insert into public.bank_line_totals (month, budget_line_id, actual)
  select p_month, r.budget_line_id, r.actual
  from jsonb_populate_recordset(null::public.bank_line_totals, p_totals) r;

  insert into public.bank_csv_rules as b (keyword, budget_line_id)
  select r.keyword, r.budget_line_id
  from jsonb_populate_recordset(null::public.bank_csv_rules, p_rules) r
  on conflict (user_id, keyword) do update set budget_line_id = excluded.budget_line_id;
end;
$$;

revoke execute on function public.save_bank_import(public.year_month, jsonb, jsonb) from public, anon;
grant execute on function public.save_bank_import(public.year_month, jsonb, jsonb) to authenticated;
