-- Tags on budget lines (issue #145, US-8 Pro features; owner decision 2026-10-07): one free tag per
-- line (« Logement », « Loisirs »…) to group the reports. Pro only: a Free account gets PT402
-- « tags_limit » (HTTP 402, the paywall). The plan's computation ignores tags. save_budget lists its
-- columns explicitly, so saving the budget keeps each line's tag.
-- Revert: drop trigger budget_lines_tag_pro on public.budget_lines; drop function public.enforce_pro_tags();
--         alter table public.budget_lines drop column tag;

alter table public.budget_lines
  add column tag text check (tag is null or char_length(btrim(tag)) between 1 and 30);

create function public.enforce_pro_tags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tag is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.tag is not distinct from new.tag then
      return new;
    end if;
  end if;
  if not public.has_pro(new.user_id) then
    raise exception 'tags_limit' using errcode = 'PT402', detail = 'Tags are a Pro feature';
  end if;
  return new;
end;
$$;

create trigger budget_lines_tag_pro before insert or update of tag on public.budget_lines
  for each row execute function public.enforce_pro_tags();

revoke execute on function public.enforce_pro_tags() from public, anon, authenticated;
