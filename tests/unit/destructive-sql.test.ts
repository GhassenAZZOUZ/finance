/** Destructive-migration check (issue #101): which SQL waits for the owner's approval before the hosted push. */
import { describe, expect, it } from "vitest";
import { findDestructive, maskSql } from "../../scripts/destructive-sql.mjs";

const rules = (sql: string) => findDestructive(sql).map((f: { rule: string }) => f.rule);

describe("findDestructive", () => {
  it.each([
    ["drop table public.bank_line_totals;", "DROP"],
    ["drop function public.save_actual(jsonb, jsonb);", "DROP"],
    ["drop policy if exists own_rows on public.loans;", "DROP"],
    ["drop index loans_user_idx;", "DROP"],
    ["alter table public.loans drop column type;", "ALTER … DROP"],
    ["alter table public.loans drop constraint loans_principal_check;", "ALTER … DROP"],
    ["alter table public.loans rename column type to kind;", "ALTER … RENAME"],
    ["alter table public.loans rename to debts;", "ALTER … RENAME"],
    ["truncate public.loans;", "TRUNCATE"],
    ["truncate table public.loans cascade;", "TRUNCATE"],
    ["delete from public.loans;", "DELETE without WHERE"],
    ["update public.loans set apr = 0;", "UPDATE without WHERE"],
  ])("flags %s", (sql, rule) => {
    expect(rules(sql)).toEqual([rule]);
  });

  it.each([
    ["create table public.x (id uuid primary key);"],
    ["alter table public.loans add column kind text not null default 'loan';"],
    ["alter table public.loans alter column type drop not null;"],
    ["alter table public.loans alter column apr drop default;"],
    ["revoke truncate, references, trigger on public.loans from authenticated;"],
    ["grant select, insert on public.loans to authenticated;"],
    ["delete from public.loans where user_id = auth.uid();"],
    ["update public.loans set kind = 'overdraft' where type ilike '%découvert%';"],
    ["create or replace function f() returns void language sql as $$ select 1 $$;"],
  ])("does not flag %s", (sql) => {
    expect(rules(sql)).toEqual([]);
  });

  it("ignores comments and string literals", () => {
    expect(rules("-- drop table loans;\n/* truncate loans; */\ncomment on table loans is 'never drop table loans';")).toEqual([]);
  });

  it("checks statements inside function bodies", () => {
    expect(rules("create function purge() returns void language sql as $$ delete from public.loans; $$;")).toEqual(["DELETE without WHERE"]);
  });

  it("reports a statement once, with its line", () => {
    const findings = findDestructive("create table a (id int);\n\nalter table public.loans\n  drop column type;\n");
    expect(findings).toEqual([{ rule: "ALTER … DROP", line: 3, text: "alter table public.loans" }]);
  });

  it("keeps offsets: masking preserves the length and the line breaks", () => {
    const sql = "select 1; -- note\n'a''b' /* x\ny */";
    const masked = maskSql(sql);
    expect(masked).toHaveLength(sql.length);
    expect(masked.split("\n")).toHaveLength(sql.split("\n").length);
  });
});
