import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIMARY_GOAL_ID, centsToEuros, eurosToCents } from "@/lib/engine";
import type {
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
  MonthlyActualDraft,
  SavingsGoal,
  SavingsGoalDraft,
} from "@/lib/domain/types";
import { type FinanceRepository, type RebaseChanges, RepositoryError } from "./repository";

// Row shapes as returned by PostgREST (numeric columns arrive as JSON numbers).
interface SettingsRow {
  start_month: string;
  moving_goal: number;
  moving_deadline_month: string;
  moving_already_saved: number;
  emergency_target: number;
  emergency_existing: number;
  free_savings_existing: number;
  risk_free_rate: number;
  early_repayment_pct: number;
  moving_name: string;
  moving_priority: number;
}
interface GoalRow {
  id: string;
  name: string;
  target: number;
  deadline_month: string;
  already_saved: number;
  priority: number;
}
interface LineRow {
  id: string;
  category: BudgetCategory;
  label: string;
  amount: number;
  position: number;
  start_month: string | null;
  end_month: string | null;
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
  moving_savings: number;
  emergency_savings: number;
  free_savings: number;
  planned_debt: number | null;
  planned_savings: number | null;
  planned_income: number | null;
  planned_expenses: number | null;
  plan_start_month: string | null;
  monthly_actual_loan_balances: { loan_id: string; balance: number }[];
  monthly_actual_goal_balances: { goal_id: string; balance: number }[];
}

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
    moving_goal: euros(s.movingGoal),
    moving_deadline_month: s.movingDeadlineMonth,
    moving_already_saved: euros(s.movingAlreadySaved),
    emergency_target: euros(s.emergencyTarget),
    emergency_existing: euros(s.emergencyExisting),
    free_savings_existing: euros(s.freeSavingsExisting),
    risk_free_rate: s.riskFreeRate,
    early_repayment_pct: s.earlyRepaymentPct,
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
  };
}

export class SupabaseFinanceRepository implements FinanceRepository {
  constructor(private readonly db: SupabaseClient) {}

  async load(): Promise<FinanceSnapshot> {
    const [settings, lines, loans, actuals, exceptions, goals, profile] = await Promise.all([
      this.db.from("budget_settings").select("*").maybeSingle<SettingsRow>(),
      this.db
        .from("budget_lines")
        .select("id, category, label, amount, position, start_month, end_month")
        .order("position")
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
          "id, month, income, expenses, moving_savings, emergency_savings, free_savings, planned_debt, planned_savings, planned_income, planned_expenses, plan_start_month, monthly_actual_loan_balances(loan_id, balance), monthly_actual_goal_balances(goal_id, balance)",
        )
        .order("month")
        .returns<ActualRow[]>(),
      this.db
        .from("budget_exceptions")
        .select("id, month, kind, label, amount")
        .order("month")
        .order("created_at")
        .returns<ExceptionRow[]>(),
      this.db
        .from("savings_goals")
        .select("id, name, target, deadline_month, already_saved, priority")
        .order("priority")
        .returns<GoalRow[]>(),
      this.db.from("profiles").select("reminder_enabled").maybeSingle<{ reminder_enabled: boolean }>(),
    ]);
    const s = checkMaybe(settings);
    const allLoans = check(loans).map(toLoan);
    // The primary goal is the moving fund of the settings (SPEC D23).
    const primary: SavingsGoal[] = s
      ? [
          {
            id: PRIMARY_GOAL_ID,
            name: s.moving_name,
            target: cents(s.moving_goal),
            deadlineMonth: s.moving_deadline_month,
            alreadySaved: cents(s.moving_already_saved),
            priority: s.moving_priority,
            primary: true,
          },
        ]
      : [];
    const extra = check(goals).map(
      (g): SavingsGoal => ({
        id: g.id,
        name: g.name,
        target: cents(g.target),
        deadlineMonth: g.deadline_month,
        alreadySaved: cents(g.already_saved),
        priority: g.priority,
        primary: false,
      }),
    );
    return {
      settings: s && {
        startMonth: s.start_month,
        movingGoal: cents(s.moving_goal),
        movingDeadlineMonth: s.moving_deadline_month,
        movingAlreadySaved: cents(s.moving_already_saved),
        emergencyTarget: cents(s.emergency_target),
        emergencyExisting: cents(s.emergency_existing),
        freeSavingsExisting: cents(s.free_savings_existing),
        riskFreeRate: Number(s.risk_free_rate),
        earlyRepaymentPct: Number(s.early_repayment_pct),
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
        }),
      ),
      exceptions: check(exceptions).map(toException),
      loans: allLoans.filter((l) => l.archivedAt === null),
      archivedLoans: allLoans.filter((l) => l.archivedAt !== null),
      reminderEnabled: checkMaybe(profile)?.reminder_enabled ?? true,
      goals: [...primary, ...extra].sort((a, b) => a.priority - b.priority || Number(b.primary) - Number(a.primary)),
      actuals: check(actuals).map(
        (a): MonthlyActual => ({
          id: a.id,
          month: a.month,
          income: centsOrNull(a.income),
          expenses: centsOrNull(a.expenses),
          movingSavings: cents(a.moving_savings),
          emergencySavings: cents(a.emergency_savings),
          freeSavings: cents(a.free_savings),
          loanBalances: a.monthly_actual_loan_balances.map((b) => ({ loanId: b.loan_id, balance: cents(b.balance) })),
          goalBalances: a.monthly_actual_goal_balances.map((b) => ({ goalId: b.goal_id, balance: cents(b.balance) })),
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

  /** One transaction (Postgres function `rebase_plan`). */
  async rebasePlan(changes: RebaseChanges): Promise<void> {
    checkMaybe(
      await this.db.rpc("rebase_plan", {
        p_settings: settingsColumns(changes.settings),
        p_freezes: freezeRows(changes.freezes),
        p_loan_updates: changes.loanUpdates.map(({ id, draft }) => ({ id, ...loanColumns(draft) })),
        p_loans_to_archive: changes.loansToArchive,
        p_goal_updates: changes.goalUpdates.map(({ id, draft }) => ({ id, ...goalColumns(draft) })),
      }),
    );
  }

  async saveBudget(settings: BudgetSettings, lines: BudgetLineDraft[]): Promise<void> {
    await this.saveSettings(settings);

    const existing = check(await this.db.from("budget_lines").select("id").returns<{ id: string }[]>());
    const kept = new Set(lines.flatMap((l) => (l.id ? [l.id] : [])));
    const removed = existing.map((r) => r.id).filter((id) => !kept.has(id));
    if (removed.length > 0) checkMaybe(await this.db.from("budget_lines").delete().in("id", removed));

    const columns = (l: BudgetLineDraft) => ({
      category: l.category,
      label: l.label.trim(),
      amount: euros(l.amount),
      position: l.position,
      start_month: l.startMonth,
      end_month: l.endMonth,
    });
    const updates = lines.filter((l) => l.id).map((l) => ({ id: l.id, ...columns(l) }));
    const inserts = lines.filter((l) => !l.id).map(columns);
    if (updates.length > 0) checkMaybe(await this.db.from("budget_lines").upsert(updates, { onConflict: "id" }));
    if (inserts.length > 0) checkMaybe(await this.db.from("budget_lines").insert(inserts));
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
          moving_savings: euros(draft.movingSavings),
          emergency_savings: euros(draft.emergencySavings),
          free_savings: euros(draft.freeSavings),
          ...(draft.frozen ? frozenColumns(draft.frozen) : {}),
        },
        p_loan_balances: draft.loanBalances.map((b) => ({ loan_id: b.loanId, balance: euros(b.balance) })),
        p_goal_balances: draft.goalBalances.map((b) => ({ goal_id: b.goalId, balance: euros(b.balance) })),
      }),
    );
  }

  async createGoal(draft: SavingsGoalDraft, priority: number): Promise<SavingsGoal> {
    const row = check(
      await this.db
        .from("savings_goals")
        .insert({ ...goalColumns(draft), priority })
        .select("id, name, target, deadline_month, already_saved, priority")
        .single<GoalRow>(),
    );
    return {
      id: row.id,
      name: row.name,
      target: cents(row.target),
      deadlineMonth: row.deadline_month,
      alreadySaved: cents(row.already_saved),
      priority: row.priority,
      primary: false,
    };
  }

  async updateGoal(id: string, draft: SavingsGoalDraft): Promise<void> {
    if (id === PRIMARY_GOAL_ID) {
      const updated = check(
        await this.db
          .from("budget_settings")
          .update({
            moving_name: draft.name.trim(),
            moving_goal: euros(draft.target),
            moving_deadline_month: draft.deadlineMonth,
            moving_already_saved: euros(draft.alreadySaved),
          })
          .not("user_id", "is", null)
          .select("user_id"),
      );
      if (updated.length === 0) throw new RepositoryError("Objectif introuvable", "not_found");
      return;
    }
    const updated = check(await this.db.from("savings_goals").update(goalColumns(draft)).eq("id", id).select("id"));
    if (updated.length === 0) throw new RepositoryError("Objectif introuvable", "not_found");
  }

  async deleteGoal(id: string): Promise<void> {
    if (id === PRIMARY_GOAL_ID) throw new RepositoryError("L’objectif principal ne peut pas être supprimé", "forbidden");
    const deleted = check(await this.db.from("savings_goals").delete().eq("id", id).select("id"));
    if (deleted.length === 0) throw new RepositoryError("Objectif introuvable", "not_found");
  }

  async setReminder(enabled: boolean): Promise<void> {
    const updated = check(await this.db.from("profiles").update({ reminder_enabled: enabled }).not("user_id", "is", null).select("user_id"));
    if (updated.length === 0) throw new RepositoryError("Profil introuvable", "not_found");
  }

  async orderGoals(ids: string[]): Promise<void> {
    const primary = ids.indexOf(PRIMARY_GOAL_ID);
    if (primary >= 0) {
      checkMaybe(await this.db.from("budget_settings").update({ moving_priority: primary + 1 }).not("user_id", "is", null));
    }
    const rows = check(
      await this.db.from("savings_goals").select("id, name, target, deadline_month, already_saved, priority").returns<GoalRow[]>(),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const updates = ids.flatMap((id, i) => {
      if (id === PRIMARY_GOAL_ID) return [];
      const row = byId.get(id);
      if (!row) throw new RepositoryError("Objectif introuvable", "not_found");
      return [{ ...row, priority: i + 1 }];
    });
    // One statement: the (user, priority) unique constraint is deferred, so priorities can swap.
    if (updates.length > 0) checkMaybe(await this.db.from("savings_goals").upsert(updates, { onConflict: "id" }));
  }


  async deleteActual(month: string): Promise<void> {
    checkMaybe(await this.db.from("monthly_actuals").delete().eq("month", month));
  }
}
