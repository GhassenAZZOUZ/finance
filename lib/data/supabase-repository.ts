import type { CsvMapping } from "@/lib/import/bank-csv";
import type { SavingsDeposit } from "@/lib/domain/deposits";
import type { BankRule } from "@/lib/import/bank-rules";
import type { ActualLine } from "@/lib/domain/actual-lines";
import type { SupabaseClient } from "@supabase/supabase-js";
import { centsToEuros, eurosToCents } from "@/lib/engine";
import type {
  BankAccount,
  BankStatement,
  BudgetCategory,
  BudgetException,
  BudgetExceptionDraft,
  BudgetLine,
  BudgetLineDraft,
  BudgetSettings,
  FinanceSnapshot,
  FrozenPlan,
  Loan,
  LoanDraft,
  MonthlyActual,
  RebaseCorrection,
  MonthlyActualDraft,
  SavingsGoal,
  SavingsGoalDraft,
} from "@/lib/domain/types";
import type { ImportPlan } from "@/lib/import/apply";
import { type FinanceRepository, type RebaseChanges, RepositoryError } from "./repository";

// Row shapes as returned by PostgREST (numeric columns arrive as JSON numbers).
interface SettingsRow {
  start_month: string;
  emergency_target: number;
  emergency_existing: number;
  free_savings_existing: number;
  risk_free_rate: number;
  early_repayment_pct: number;
  expense_inflation_rate: number;
  income_growth_rate: number;
  emergency_rate: number;
  free_savings_rate: number;
}
// The old moving-fund columns were dropped (tech-debt 6.2): goals live in savings_goals.
const SETTINGS_COLUMNS =
  "start_month, emergency_target, emergency_existing, free_savings_existing, risk_free_rate, early_repayment_pct, expense_inflation_rate, income_growth_rate, emergency_rate, free_savings_rate";
interface GoalRow {
  id: string;
  name: string;
  target: number;
  deadline_month: string;
  already_saved: number;
  priority: number;
  is_primary: boolean;
  rate: number;
}
const GOAL_COLUMNS = "id, name, target, deadline_month, already_saved, priority, is_primary, rate";
const toGoal = (g: GoalRow): SavingsGoal => ({
  id: g.id,
  name: g.name,
  target: cents(g.target),
  deadlineMonth: g.deadline_month,
  alreadySaved: cents(g.already_saved),
  priority: g.priority,
  primary: g.is_primary,
  ...(Number(g.rate) ? { rate: Number(g.rate) } : {}),
});
interface LineRow {
  id: string;
  category: BudgetCategory;
  label: string;
  amount: number;
  position: number;
  start_month: string | null;
  end_month: string | null;
  indexed: boolean;
  payday_day: number;
  payday_previous_month: boolean;
  tag: string | null;
}
interface LoanRow {
  id: string;
  name: string | null;
  type: string | null;
  principal: number;
  principal_paid_through_month: string | null;
  apr: number;
  monthly_payment: number;
  contract_end_month: string | null;
  penalty_pct: number | null;
  penalty_cap_months: number | null;
  kind: "loan" | "overdraft";
  credit_limit: number | null;
  position: number;
  archived_at: string | null;
}
const LOAN_COLUMNS =
  "id, name, type, principal, principal_paid_through_month, apr, monthly_payment, contract_end_month, penalty_pct, penalty_cap_months, kind, credit_limit, position, archived_at";
interface ExceptionRow {
  id: string;
  month: string;
  kind: "income" | "expense";
  label: string;
  amount: number;
}
const toException = (r: ExceptionRow): BudgetException => ({
  id: r.id,
  month: r.month,
  kind: r.kind,
  label: r.label,
  amount: cents(r.amount),
});

interface ActualRow {
  id: string;
  month: string;
  income: number | null;
  expenses: number | null;
  emergency_savings: number;
  free_savings: number;
  planned_debt: number | null;
  planned_savings: number | null;
  planned_income: number | null;
  planned_expenses: number | null;
  plan_start_month: string | null;
  /** Hand corrections of a re-base (#100), in cents. */
  rebase_corrections: RebaseCorrection[] | null;
  monthly_actual_loan_balances: { loan_id: string; balance: number }[];
  monthly_actual_goal_balances: { goal_id: string; balance: number }[];
  monthly_actual_lines: LineRowOfActual[];
  monthly_actual_deposits: DepositRow[];
  bank_statements: StatementRow[];
}
interface StatementRow {
  account_id: string | null;
  account_name: string;
  file_name: string;
  fingerprint: string;
  transaction_count: number;
  total_in: number;
  total_out: number;
  line_totals: { budget_line_id: string; actual: number }[];
  position: number;
}
interface BankAccountRow {
  id: string;
  name: string;
  mapping: CsvMapping | null;
}
interface DepositRow {
  pot: SavingsDeposit["pot"];
  goal_id: string | null;
  goal_name: string | null;
  planned: number;
  amount: number;
  position: number;
}
interface LineRowOfActual {
  kind: ActualLine["kind"];
  direction: ActualLine["direction"];
  category: ActualLine["category"];
  budget_line_id: string | null;
  exception_id: string | null;
  label: string;
  planned: number;
  actual: number;
  position: number;
}
const ACTUAL_LINE_COLUMNS = "kind, direction, category, budget_line_id, exception_id, label, planned, actual, position";

const cents = (euros: number) => eurosToCents(Number(euros));

function frozenColumns(f: FrozenPlan) {
  return {
    planned_debt: centsToEuros(f.plannedDebt),
    planned_savings: centsToEuros(f.plannedSavings),
    planned_income: centsToEuros(f.plannedIncome),
    planned_expenses: centsToEuros(f.plannedExpenses),
    plan_start_month: f.planStartMonth,
  };
}
const centsOrNull = (euros: number | null) => (euros === null ? null : cents(euros));
const euros = (value: number) => centsToEuros(value);
const eurosOrNull = (value: number | null) => (value === null ? null : euros(value));

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

/** Throws on error; for queries that may legitimately return no row (`maybeSingle`). */
function checkMaybe<T>(result: Result<T>): T | null {
  if (result.error) throw new RepositoryError(result.error.message, result.error.code);
  return result.data;
}

/** Throws on error or on a missing result. */
function check<T>(result: Result<T>): T {
  const data = checkMaybe(result);
  if (data === null) throw new RepositoryError("Réponse vide de la base de données");
  return data;
}

function toLoan(r: LoanRow): Loan {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    principal: cents(r.principal),
    principalPaidThroughMonth: r.principal_paid_through_month,
    apr: Number(r.apr),
    monthlyPayment: cents(r.monthly_payment),
    contractEndMonth: r.contract_end_month,
    penaltyPct: r.penalty_pct === null ? null : Number(r.penalty_pct),
    penaltyCapMonths: r.penalty_cap_months,
    kind: r.kind,
    creditLimit: centsOrNull(r.credit_limit),
    position: r.position,
    archivedAt: r.archived_at,
  };
}

function loanColumns(d: LoanDraft) {
  return {
    name: d.name?.trim() || null,
    type: d.type?.trim() || null,
    principal: euros(d.principal),
    principal_paid_through_month: d.principalPaidThroughMonth,
    apr: d.apr,
    monthly_payment: euros(d.monthlyPayment),
    contract_end_month: d.contractEndMonth,
    penalty_pct: d.penaltyPct,
    penalty_cap_months: d.penaltyCapMonths,
    kind: d.kind,
    credit_limit: eurosOrNull(d.creditLimit),
  };
}

function settingsColumns(s: BudgetSettings) {
  return {
    start_month: s.startMonth,
    emergency_target: euros(s.emergencyTarget),
    emergency_existing: euros(s.emergencyExisting),
    free_savings_existing: euros(s.freeSavingsExisting),
    risk_free_rate: s.riskFreeRate,
    early_repayment_pct: s.earlyRepaymentPct,
    // Not in the template (SPEC D20): an import sets them to 0.
    expense_inflation_rate: s.expenseInflationRate ?? 0,
    income_growth_rate: s.incomeGrowthRate ?? 0,
    emergency_rate: s.emergencyRate ?? 0,
    free_savings_rate: s.freeSavingsRate ?? 0,
  };
}

function lineColumns(l: BudgetLineDraft) {
  return {
    category: l.category,
    label: l.label.trim(),
    amount: euros(l.amount),
    position: l.position,
    start_month: l.startMonth,
    end_month: l.endMonth,
    indexed: l.indexed !== false,
    payday_day: l.paydayDay ?? 1,
    payday_previous_month: l.paydayPreviousMonth ?? false,
  };
}

const freezeRows = (items: { month: string; frozen: FrozenPlan }[]) =>
  items.map(({ month, frozen }) => ({ month, ...frozenColumns(frozen) }));

function goalColumns(d: SavingsGoalDraft) {
  return {
    name: d.name.trim(),
    target: euros(d.target),
    deadline_month: d.deadlineMonth,
    already_saved: euros(d.alreadySaved),
    rate: d.rate ?? 0,
  };
}

export class SupabaseFinanceRepository implements FinanceRepository {
  constructor(private readonly db: SupabaseClient) {}

  async load(): Promise<FinanceSnapshot> {
    const [settings, lines, loans, actuals, exceptions, goals, profile, incomePayments, bankRules, rebaseUndo, bankAccounts, entitlement] = await Promise.all([
      this.db.from("budget_settings").select(SETTINGS_COLUMNS).maybeSingle<SettingsRow>(),
      this.db
        .from("budget_lines")
        .select("id, category, label, amount, position, start_month, end_month, indexed, payday_day, payday_previous_month, tag")
        // Lines of different categories share positions: the id makes the order stable between loads.
        .order("position")
        .order("id")
        .returns<LineRow[]>(),
      this.db
        .from("loans")
        .select(LOAN_COLUMNS)
        .order("position")
        .order("created_at")
        .returns<LoanRow[]>(),
      this.db
        .from("monthly_actuals")
        .select(
          `id, month, income, expenses, emergency_savings, free_savings, planned_debt, planned_savings, planned_income, planned_expenses, plan_start_month, rebase_corrections, monthly_actual_loan_balances(loan_id, balance), monthly_actual_goal_balances(goal_id, balance), monthly_actual_lines(${ACTUAL_LINE_COLUMNS}), monthly_actual_deposits(pot, goal_id, goal_name, planned, amount, position), bank_statements(account_id, account_name, file_name, fingerprint, transaction_count, total_in, total_out, line_totals, position)`,
        )
        .order("month")
        .returns<ActualRow[]>(),
      this.db
        .from("budget_exceptions")
        .select("id, month, kind, label, amount")
        .order("month")
        .order("created_at")
        .returns<ExceptionRow[]>(),
      this.db.from("savings_goals").select(GOAL_COLUMNS).order("priority").returns<GoalRow[]>(),
      this.db
        .from("profiles")
        .select("reminder_enabled, bank_csv_mapping")
        .maybeSingle<{ reminder_enabled: boolean; bank_csv_mapping: CsvMapping | null }>(),
      this.db
        .from("income_payments")
        .select("month, budget_line_id, paid_on")
        .order("month")
        .returns<{ month: string; budget_line_id: string; paid_on: string }[]>(),
      this.db.from("bank_csv_rules").select("id, keyword, budget_line_id").order("keyword").returns<{ id: string; keyword: string; budget_line_id: string | null }[]>(),
      this.db.from("plan_rebase_undo").select("from_month, new_start_month").maybeSingle<{ from_month: string; new_start_month: string }>(),
      this.db.from("bank_accounts").select("id, name, mapping").order("created_at").order("name").returns<BankAccountRow[]>(),
      this.db.from("entitlements").select("is_pro").maybeSingle<{ is_pro: boolean }>(),
    ]);
    const undo = checkMaybe(rebaseUndo);
    const s = checkMaybe(settings);
    const allLoans = check(loans).map(toLoan);
    return {
      settings: s && {
        startMonth: s.start_month,
        emergencyTarget: cents(s.emergency_target),
        emergencyExisting: cents(s.emergency_existing),
        freeSavingsExisting: cents(s.free_savings_existing),
        riskFreeRate: Number(s.risk_free_rate),
        earlyRepaymentPct: Number(s.early_repayment_pct),
        expenseInflationRate: Number(s.expense_inflation_rate),
        incomeGrowthRate: Number(s.income_growth_rate),
        emergencyRate: Number(s.emergency_rate),
        freeSavingsRate: Number(s.free_savings_rate),
      },
      lines: check(lines).map(
        (l): BudgetLine => ({
          id: l.id,
          category: l.category,
          label: l.label,
          amount: cents(l.amount),
          position: l.position,
          startMonth: l.start_month,
          endMonth: l.end_month,
          ...(l.indexed ? {} : { indexed: false }),
          ...(l.tag ? { tag: l.tag } : {}),
          // Income lines only (SPEC D29); the default payday (1 of the same month) is left out.
          ...(l.category === "income" && (l.payday_day !== 1 || l.payday_previous_month)
            ? { paydayDay: l.payday_day, paydayPreviousMonth: l.payday_previous_month }
            : {}),
        }),
      ),
      exceptions: check(exceptions).map(toException),
      loans: allLoans.filter((l) => l.archivedAt === null),
      archivedLoans: allLoans.filter((l) => l.archivedAt !== null),
      reminderEnabled: checkMaybe(profile)?.reminder_enabled ?? true,
      bankCsvMapping: checkMaybe(profile)?.bank_csv_mapping ?? null,
      rebaseUndo: undo ? { fromMonth: undo.from_month, newStartMonth: undo.new_start_month } : null,
      bankRules: check(bankRules).map((b): BankRule => ({ id: b.id, keyword: b.keyword, budgetLineId: b.budget_line_id })),
      bankAccounts: check(bankAccounts).map((a): BankAccount => ({ id: a.id, name: a.name, mapping: a.mapping })),
      // No row: never subscribed and no grant, so Free (SPEC D35).
      isPro: checkMaybe(entitlement)?.is_pro ?? false,
      incomePayments: check(incomePayments).map((p) => ({ month: p.month, budgetLineId: p.budget_line_id, paidOn: p.paid_on })),
      goals: check(goals).map(toGoal),
      actuals: check(actuals).map(
        (a): MonthlyActual => ({
          id: a.id,
          month: a.month,
          income: centsOrNull(a.income),
          expenses: centsOrNull(a.expenses),
          emergencySavings: cents(a.emergency_savings),
          freeSavings: cents(a.free_savings),
          loanBalances: a.monthly_actual_loan_balances.map((b) => ({ loanId: b.loan_id, balance: cents(b.balance) })),
          goalBalances: a.monthly_actual_goal_balances.map((b) => ({ goalId: b.goal_id, balance: cents(b.balance) })),
          ...(a.rebase_corrections?.length ? { rebaseCorrections: a.rebase_corrections } : {}),
          // SPEC D33: with deposits, the balances above are recomputed by withComputedBalances.
          ...(a.monthly_actual_deposits.length > 0
            ? {
                deposits: [...a.monthly_actual_deposits]
                  .sort((x, y) => x.position - y.position)
                  .map((d) => ({ pot: d.pot, goalId: d.goal_id, goalName: d.goal_name, planned: cents(d.planned), amount: cents(d.amount) })),
              }
            : {}),
          ...(a.bank_statements.length > 0
            ? {
                statements: [...a.bank_statements]
                  .sort((x, y) => x.position - y.position)
                  .map(
                    (st): BankStatement => ({
                      accountId: st.account_id,
                      accountName: st.account_name,
                      fileName: st.file_name,
                      fingerprint: st.fingerprint,
                      transactionCount: st.transaction_count,
                      totalIn: cents(st.total_in),
                      totalOut: cents(st.total_out),
                      lineTotals: st.line_totals.map((t) => ({ budgetLineId: t.budget_line_id, actual: cents(t.actual) })),
                    }),
                  ),
              }
            : {}),
          lines: [...a.monthly_actual_lines]
            .sort((x, y) => x.position - y.position)
            .map((l) => ({
              kind: l.kind,
              direction: l.direction,
              category: l.category,
              budgetLineId: l.budget_line_id,
              exceptionId: l.exception_id,
              label: l.label,
              planned: cents(l.planned),
              actual: cents(l.actual),
            })),
          frozen:
            a.planned_debt === null || a.planned_savings === null || a.plan_start_month === null
              ? null
              : {
                  plannedDebt: cents(a.planned_debt),
                  plannedSavings: cents(a.planned_savings),
                  plannedIncome: cents(a.planned_income ?? 0),
                  plannedExpenses: cents(a.planned_expenses ?? 0),
                  planStartMonth: a.plan_start_month,
                },
        }),
      ),
    };
  }

  async saveSettings(settings: BudgetSettings): Promise<void> {
    checkMaybe(await this.db.from("budget_settings").upsert(settingsColumns(settings), { onConflict: "user_id" }));
  }

  /** One statement (Postgres function `freeze_actuals`), whatever the number of months. */
  async freezeActuals(items: { month: string; frozen: FrozenPlan }[]): Promise<void> {
    checkMaybe(await this.db.rpc("freeze_actuals", { p_freezes: freezeRows(items) }));
  }

  /** One transaction (Postgres function `rebase_plan_with_undo`): keeps what it changes for an undo (#100). */
  async rebasePlan(changes: RebaseChanges): Promise<void> {
    checkMaybe(
      await this.db.rpc("rebase_plan_with_undo", {
        p_from_month: changes.fromMonth,
        p_corrections: changes.corrections,
        p_settings: settingsColumns(changes.settings),
        p_freezes: freezeRows(changes.freezes),
        p_loan_updates: changes.loanUpdates.map(({ id, draft }) => ({ id, ...loanColumns(draft) })),
        p_loans_to_archive: changes.loansToArchive,
        p_goal_updates: changes.goalUpdates.map(({ id, draft }) => ({ id, ...goalColumns(draft) })),
      }),
    );
  }

  /** One transaction (Postgres function `undo_rebase`). */
  async undoRebase(): Promise<void> {
    checkMaybe(await this.db.rpc("undo_rebase"));
  }

  /** One transaction (Postgres function `save_budget`): settings and lines, or nothing. */
  async saveBudget(settings: BudgetSettings, lines: BudgetLineDraft[]): Promise<void> {
    checkMaybe(
      await this.db.rpc("save_budget", {
        p_settings: settingsColumns(settings),
        p_lines: lines.map((l) => ({ id: l.id ?? null, ...lineColumns(l) })),
      }),
    );
  }

  /** One transaction (Postgres function `apply_import`). */
  async applyImport(plan: ImportPlan): Promise<void> {
    checkMaybe(
      await this.db.rpc("apply_import", {
        p_settings: settingsColumns(plan.settings),
        p_lines: plan.lines.map((l) => ({ id: l.id ?? null, ...lineColumns(l) })),
        p_primary_goal: goalColumns(plan.primaryGoal),
        p_loan_removals: plan.loanRemovals,
        p_loan_updates: plan.loanUpdates.map(({ id, draft }) => ({ id, ...loanColumns(draft) })),
        p_loan_creates: plan.loanCreates.map(loanColumns),
      }),
    );
  }

  async addException(draft: BudgetExceptionDraft): Promise<BudgetException> {
    const row = check(
      await this.db
        .from("budget_exceptions")
        .insert({ month: draft.month, kind: draft.kind, label: draft.label.trim(), amount: euros(draft.amount) })
        .select("id, month, kind, label, amount")
        .single<ExceptionRow>(),
    );
    return toException(row);
  }

  async deleteException(id: string): Promise<void> {
    const deleted = check(await this.db.from("budget_exceptions").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new RepositoryError("Exception introuvable", "not_found");
  }

  async createLoan(draft: LoanDraft): Promise<Loan> {
    const last = check(
      await this.db.from("loans").select("position").order("position", { ascending: false }).limit(1).returns<{ position: number }[]>(),
    );
    const position = (last[0]?.position ?? -1) + 1;
    const row = check(
      await this.db
        .from("loans")
        .insert({ ...loanColumns(draft), position })
        .select(LOAN_COLUMNS)
        .single<LoanRow>(),
    );
    return toLoan(row);
  }

  async updateLoan(id: string, draft: LoanDraft): Promise<void> {
    const updated = check(await this.db.from("loans").update(loanColumns(draft)).eq("id", id).select("id"));
    if (updated.length === 0) throw new RepositoryError("Crédit introuvable", "not_found");
  }

  async removeLoan(id: string): Promise<"deleted" | "archived"> {
    const refs = check(
      await this.db.from("monthly_actual_loan_balances").select("id").eq("loan_id", id).limit(1).returns<{ id: string }[]>(),
    );
    if (refs.length > 0) {
      const archived = check(
        await this.db.from("loans").update({ archived_at: new Date().toISOString() }).eq("id", id).select("id"),
      );
      if (archived.length === 0) throw new RepositoryError("Crédit introuvable", "not_found");
      return "archived";
    }
    const deleted = check(await this.db.from("loans").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new RepositoryError("Crédit introuvable", "not_found");
    return "deleted";
  }

  /** One transaction (Postgres function `save_actual`): the month and its balances, or nothing. */
  async saveActual(draft: MonthlyActualDraft): Promise<void> {
    checkMaybe(
      await this.db.rpc("save_actual", {
        p_actual: {
          month: draft.month,
          income: eurosOrNull(draft.income),
          expenses: eurosOrNull(draft.expenses),
          // With deposits (SPEC D33) the balances are computed, not stored.
          emergency_savings: draft.deposits?.length ? null : euros(draft.emergencySavings),
          free_savings: draft.deposits?.length ? null : euros(draft.freeSavings),
          ...(draft.frozen ? frozenColumns(draft.frozen) : {}),
        },
        p_loan_balances: draft.loanBalances.map((b) => ({ loan_id: b.loanId, balance: euros(b.balance) })),
        p_goal_balances: draft.deposits?.length ? [] : draft.goalBalances.map((b) => ({ goal_id: b.goalId, balance: euros(b.balance) })),
        p_lines: draft.lines.map((l, position) => ({
          kind: l.kind,
          direction: l.direction,
          category: l.category,
          budget_line_id: l.budgetLineId,
          exception_id: l.exceptionId,
          label: l.label,
          planned: euros(l.planned),
          actual: euros(l.actual),
          position,
        })),
        p_deposits: (draft.deposits ?? []).map((d, position) => ({
          pot: d.pot,
          goal_id: d.goalId,
          goal_name: d.goalName,
          planned: centsToEuros(d.planned),
          amount: centsToEuros(d.amount),
          position,
        })),
        // Omitted (another caller): the saved statements are kept (#115).
        p_statements:
          draft.statements === undefined
            ? null
            : draft.statements.map((st, position) => ({
                account_id: st.accountId,
                account_name: st.accountName,
                file_name: st.fileName,
                fingerprint: st.fingerprint,
                transaction_count: st.transactionCount,
                total_in: centsToEuros(st.totalIn),
                total_out: centsToEuros(st.totalOut),
                line_totals: st.lineTotals.map((t) => ({ budget_line_id: t.budgetLineId, actual: centsToEuros(t.actual) })),
                position,
              })),
      }),
    );
  }

  /** The first goal of a user becomes the primary one (database trigger). */
  async createGoal(draft: SavingsGoalDraft, priority: number): Promise<SavingsGoal> {
    return toGoal(
      check(await this.db.from("savings_goals").insert({ ...goalColumns(draft), priority }).select(GOAL_COLUMNS).single<GoalRow>()),
    );
  }

  async updateGoal(id: string, draft: SavingsGoalDraft): Promise<void> {
    const updated = check(await this.db.from("savings_goals").update(goalColumns(draft)).eq("id", id).select("id"));
    if (updated.length === 0) throw new RepositoryError("Objectif introuvable", "not_found");
  }

  /** One transaction (Postgres function `delete_goal`): hands the primary flag over, closes the priority gap. */
  async deleteGoal(id: string, newPrimaryId?: string): Promise<void> {
    checkMaybe(await this.db.rpc("delete_goal", { p_id: id, p_new_primary: newPrimaryId ?? null }));
  }

  async setReminder(enabled: boolean): Promise<void> {
    const updated = check(await this.db.from("profiles").update({ reminder_enabled: enabled }).not("user_id", "is", null).select("user_id"));
    if (updated.length === 0) throw new RepositoryError("Profil introuvable", "not_found");
  }

  async setBankCsvMapping(mapping: CsvMapping | null): Promise<void> {
    const updated = check(
      await this.db.from("profiles").update({ bank_csv_mapping: mapping }).not("user_id", "is", null).select("user_id"),
    );
    if (updated.length === 0) throw new RepositoryError("Profil introuvable", "not_found");
  }

  /** One transaction (Postgres function `save_bank_import`): the month's totals replaced, the rules upserted. */
  async saveBankRules(rules: Omit<BankRule, "id">[]): Promise<void> {
    checkMaybe(await this.db.rpc("save_bank_rules", { p_rules: rules.map((r) => ({ keyword: r.keyword, budget_line_id: r.budgetLineId })) }));
  }

  async deleteBankRule(id: string): Promise<void> {
    checkMaybe(await this.db.from("bank_csv_rules").delete().eq("id", id));
  }

  /** Pro (#145): the line's tag, or none with null; a Free account gets PT402 « tags_limit ». */
  async setLineTag(id: string, tag: string | null): Promise<void> {
    const updated = check(await this.db.from("budget_lines").update({ tag: tag?.trim() || null }).eq("id", id).select("id"));
    if (updated.length === 0) throw new RepositoryError("Ligne introuvable", "not_found");
  }

  async createBankAccount(name: string, mapping: CsvMapping | null): Promise<BankAccount> {
    const row = check(
      await this.db.from("bank_accounts").insert({ name: name.trim(), mapping }).select("id, name, mapping").single<BankAccountRow>(),
    );
    return { id: row.id, name: row.name, mapping: row.mapping };
  }

  async updateBankAccount(id: string, patch: { name?: string; mapping?: CsvMapping | null }): Promise<void> {
    const columns = {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.mapping !== undefined ? { mapping: patch.mapping } : {}),
    };
    const updated = check(await this.db.from("bank_accounts").update(columns).eq("id", id).select("id"));
    if (updated.length === 0) throw new RepositoryError("Compte introuvable", "not_found");
  }

  async deleteBankAccount(id: string): Promise<void> {
    checkMaybe(await this.db.from("bank_accounts").delete().eq("id", id));
  }

  async setIncomePayment(month: string, budgetLineId: string, paidOn: string | null): Promise<void> {
    if (paidOn === null) {
      checkMaybe(await this.db.from("income_payments").delete().eq("month", month).eq("budget_line_id", budgetLineId));
      return;
    }
    checkMaybe(
      await this.db
        .from("income_payments")
        .upsert({ month, budget_line_id: budgetLineId, paid_on: paidOn }, { onConflict: "user_id,month,budget_line_id" }),
    );
  }

  async deleteAccount(): Promise<void> {
    checkMaybe(await this.db.rpc("delete_my_account"));
  }

  async orderGoals(ids: string[]): Promise<void> {
    const rows = check(await this.db.from("savings_goals").select(GOAL_COLUMNS).returns<GoalRow[]>());
    const byId = new Map(rows.map((r) => [r.id, r]));
    const updates = ids.map((id, i) => {
      const row = byId.get(id);
      if (!row) throw new RepositoryError("Objectif introuvable", "not_found");
      return { ...row, priority: i + 1 };
    });
    // One statement: the (user, priority) unique constraint is deferred, so priorities can swap.
    if (updates.length > 0) checkMaybe(await this.db.from("savings_goals").upsert(updates, { onConflict: "id" }));
  }

  async deleteActual(month: string): Promise<void> {
    checkMaybe(await this.db.from("monthly_actuals").delete().eq("month", month));
  }
}
