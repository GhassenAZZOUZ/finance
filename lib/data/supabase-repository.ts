import type { SupabaseClient } from "@supabase/supabase-js";
import { centsToEuros, eurosToCents } from "@/lib/engine";
import type {
  BudgetCategory,
  BudgetLine,
  BudgetLineDraft,
  BudgetSettings,
  FinanceSnapshot,
  Loan,
  LoanDraft,
  MonthlyActual,
  MonthlyActualDraft,
} from "@/lib/domain/types";
import { type FinanceRepository, RepositoryError } from "./repository";

// Row shapes as returned by PostgREST (numeric columns arrive as JSON numbers).
interface SettingsRow {
  start_month: string;
  moving_goal: number;
  moving_deadline_month: string;
  moving_already_saved: number;
  emergency_target: number;
  emergency_existing: number;
  risk_free_rate: number;
  early_repayment_pct: number;
}
interface LineRow {
  id: string;
  category: BudgetCategory;
  label: string;
  amount: number;
  position: number;
}
interface LoanRow {
  id: string;
  name: string | null;
  type: string | null;
  principal: number;
  apr: number;
  monthly_payment: number;
  position: number;
  archived_at: string | null;
}
interface ActualRow {
  id: string;
  month: string;
  income: number | null;
  expenses: number | null;
  moving_savings: number;
  emergency_savings: number;
  free_savings: number;
  monthly_actual_loan_balances: { loan_id: string; balance: number }[];
}

const cents = (euros: number) => eurosToCents(Number(euros));
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
    apr: Number(r.apr),
    monthlyPayment: cents(r.monthly_payment),
    position: r.position,
    archivedAt: r.archived_at,
  };
}

function loanColumns(d: LoanDraft) {
  return {
    name: d.name?.trim() || null,
    type: d.type?.trim() || null,
    principal: euros(d.principal),
    apr: d.apr,
    monthly_payment: euros(d.monthlyPayment),
  };
}

export class SupabaseFinanceRepository implements FinanceRepository {
  constructor(private readonly db: SupabaseClient) {}

  async load(): Promise<FinanceSnapshot> {
    const [settings, lines, loans, actuals] = await Promise.all([
      this.db.from("budget_settings").select("*").maybeSingle<SettingsRow>(),
      this.db.from("budget_lines").select("id, category, label, amount, position").order("position").returns<LineRow[]>(),
      this.db
        .from("loans")
        .select("id, name, type, principal, apr, monthly_payment, position, archived_at")
        .order("position")
        .order("created_at")
        .returns<LoanRow[]>(),
      this.db
        .from("monthly_actuals")
        .select(
          "id, month, income, expenses, moving_savings, emergency_savings, free_savings, monthly_actual_loan_balances(loan_id, balance)",
        )
        .order("month")
        .returns<ActualRow[]>(),
    ]);
    const s = checkMaybe(settings);
    const allLoans = check(loans).map(toLoan);
    return {
      settings: s && {
        startMonth: s.start_month,
        movingGoal: cents(s.moving_goal),
        movingDeadlineMonth: s.moving_deadline_month,
        movingAlreadySaved: cents(s.moving_already_saved),
        emergencyTarget: cents(s.emergency_target),
        emergencyExisting: cents(s.emergency_existing),
        riskFreeRate: Number(s.risk_free_rate),
        earlyRepaymentPct: Number(s.early_repayment_pct),
      },
      lines: check(lines).map(
        (l): BudgetLine => ({ id: l.id, category: l.category, label: l.label, amount: cents(l.amount), position: l.position }),
      ),
      loans: allLoans.filter((l) => l.archivedAt === null),
      archivedLoans: allLoans.filter((l) => l.archivedAt !== null),
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
        }),
      ),
    };
  }

  async saveBudget(settings: BudgetSettings, lines: BudgetLineDraft[]): Promise<void> {
    checkMaybe(
      await this.db.from("budget_settings").upsert(
        {
          start_month: settings.startMonth,
          moving_goal: euros(settings.movingGoal),
          moving_deadline_month: settings.movingDeadlineMonth,
          moving_already_saved: euros(settings.movingAlreadySaved),
          emergency_target: euros(settings.emergencyTarget),
          emergency_existing: euros(settings.emergencyExisting),
          risk_free_rate: settings.riskFreeRate,
          early_repayment_pct: settings.earlyRepaymentPct,
        },
        { onConflict: "user_id" },
      ),
    );

    const existing = check(await this.db.from("budget_lines").select("id").returns<{ id: string }[]>());
    const kept = new Set(lines.flatMap((l) => (l.id ? [l.id] : [])));
    const removed = existing.map((r) => r.id).filter((id) => !kept.has(id));
    if (removed.length > 0) checkMaybe(await this.db.from("budget_lines").delete().in("id", removed));

    const columns = (l: BudgetLineDraft) => ({
      category: l.category,
      label: l.label.trim(),
      amount: euros(l.amount),
      position: l.position,
    });
    const updates = lines.filter((l) => l.id).map((l) => ({ id: l.id, ...columns(l) }));
    const inserts = lines.filter((l) => !l.id).map(columns);
    if (updates.length > 0) checkMaybe(await this.db.from("budget_lines").upsert(updates, { onConflict: "id" }));
    if (inserts.length > 0) checkMaybe(await this.db.from("budget_lines").insert(inserts));
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
        .select("id, name, type, principal, apr, monthly_payment, position, archived_at")
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

  async saveActual(draft: MonthlyActualDraft): Promise<void> {
    const actual = check(
      await this.db
        .from("monthly_actuals")
        .upsert(
          {
            month: draft.month,
            income: eurosOrNull(draft.income),
            expenses: eurosOrNull(draft.expenses),
            moving_savings: euros(draft.movingSavings),
            emergency_savings: euros(draft.emergencySavings),
            free_savings: euros(draft.freeSavings),
          },
          { onConflict: "user_id,month" },
        )
        .select("id")
        .single<{ id: string }>(),
    );
    checkMaybe(await this.db.from("monthly_actual_loan_balances").delete().eq("monthly_actual_id", actual.id));
    if (draft.loanBalances.length > 0) {
      checkMaybe(
        await this.db.from("monthly_actual_loan_balances").insert(
          draft.loanBalances.map((b) => ({ monthly_actual_id: actual.id, loan_id: b.loanId, balance: euros(b.balance) })),
        ),
      );
    }
  }

  async deleteActual(month: string): Promise<void> {
    checkMaybe(await this.db.from("monthly_actuals").delete().eq("month", month));
  }
}
