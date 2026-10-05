/**
 * Re-basing the plan without breaking the history (SPEC D16, issue #5). Pure functions: the
 * form actions apply their result through the repository.
 */
import { type Cents, type YearMonth, addMonths, compareMonths, plannedSnapshot } from "@/lib/engine";
import type { ComputedPlan } from "./plan";
import type {
  BudgetSettings,
  FinanceSnapshot,
  FrozenPlan,
  Loan,
  LoanDraft,
  MonthlyActual,
  RebaseCorrection,
  SavingsGoalDraft,
} from "./types";

/** Planned values to store with a check-in of `month`: the existing frozen ones win (history is stable). */
export function frozenFor(month: YearMonth, plan: ComputedPlan, existing: MonthlyActual | undefined): FrozenPlan | null {
  if (existing?.frozen) return existing.frozen;
  const snap = plannedSnapshot(plan.result, plan.input.budget, month);
  if (!snap) return null;
  return {
    plannedDebt: snap.debt,
    plannedSavings: snap.savings,
    plannedIncome: snap.income,
    plannedExpenses: snap.expenses,
    planStartMonth: plan.input.budget.startMonth,
  };
}

export interface RebasePlan {
  /** Check-in the new plan starts from (its balances are end-of-month values). */
  fromMonth: YearMonth;
  newStartMonth: YearMonth;
  settings: BudgetSettings;
  /** Loans whose remaining principal is taken from the check-in. */
  loanUpdates: { id: string; draft: LoanDraft }[];
  /** Loans fully repaid according to the check-in (balance 0): archived. */
  loansToArchive: string[];
  /** Existing check-ins frozen with the current plan before it changes. */
  freezes: { month: YearMonth; frozen: FrozenPlan }[];
  /** Extra savings goals whose « already saved » becomes the check-in's balance (SPEC D23). */
  goalUpdates: { id: string; draft: SavingsGoalDraft }[];
}

/**
 * What "Recaler le plan" changes: the plan restarts the month after the latest check-in, from
 * its real balances (savings as starting amounts, loan principals as read after that month's
 * payment). Null without any check-in, or when the latest one is not after the plan start.
 */
export function planRebase(snapshot: FinanceSnapshot, plan: ComputedPlan): RebasePlan | null {
  const settings = snapshot.settings;
  const latest = snapshot.actuals.reduce<MonthlyActual | undefined>(
    (acc, a) => (!acc || compareMonths(a.month, acc.month) > 0 ? a : acc),
    undefined,
  );
  if (!settings || !latest) return null;
  const newStartMonth = addMonths(latest.month, 1);
  if (compareMonths(newStartMonth, settings.startMonth) <= 0) return null;

  const balances = new Map(latest.loanBalances.map((b) => [b.loanId, b.balance]));
  const loanUpdates: RebasePlan["loanUpdates"] = [];
  const loansToArchive: string[] = [];
  for (const loan of snapshot.loans) {
    const balance = balances.get(loan.id);
    if (balance === undefined) continue; // added after that check-in: unchanged
    // A cleared overdraft stays available (SPEC D24); a loan at 0 is archived.
    if (balance === 0 && loan.kind !== "overdraft") loansToArchive.push(loan.id);
    else loanUpdates.push({ id: loan.id, draft: loanDraft(loan, balance, latest.month) });
  }

  // Goals added after that check-in have no balance there: unchanged.
  const goalBalances = new Map(latest.goalBalances.map((b) => [b.goalId, b.balance]));
  const goalUpdates = snapshot.goals.flatMap((g) => {
    const balance = goalBalances.get(g.id);
    if (balance === undefined) return [];
    const { name, target, deadlineMonth } = g;
    return [{ id: g.id, draft: { name, target, deadlineMonth, alreadySaved: balance } }];
  });

  const freezes = snapshot.actuals.flatMap((a) => {
    if (a.frozen) return [];
    const frozen = frozenFor(a.month, plan, a);
    return frozen ? [{ month: a.month, frozen }] : [];
  });

  return {
    fromMonth: latest.month,
    newStartMonth,
    settings: {
      ...settings,
      startMonth: newStartMonth,
      emergencyExisting: latest.emergencySavings,
      freeSavingsExisting: latest.freeSavings,
    },
    loanUpdates,
    loansToArchive,
    freezes,
    goalUpdates,
  };
}

function loanDraft(loan: Loan, principal: number, paidThrough: YearMonth): LoanDraft {
  return {
    name: loan.name,
    type: loan.type,
    principal,
    // An overdraft balance is never projected (D24).
    principalPaidThroughMonth: loan.kind === "overdraft" ? null : paidThrough,
    apr: loan.apr,
    monthlyPayment: loan.monthlyPayment,
    contractEndMonth: loan.contractEndMonth,
    penaltyPct: loan.penaltyPct,
    penaltyCapMonths: loan.penaltyCapMonths,
    kind: loan.kind,
    creditLimit: loan.creditLimit,
  };
}

/* --------------------------------- #100 Starting values corrected by hand --------------------------------- */

/** A starting value of the re-base, editable in its preview: `key` is `emergency`, `free`, `goal:<id>` or `loan:<id>`. */
export interface RebaseField {
  key: string;
  label: string;
  /** What the check-in read. */
  read: Cents;
}

/** The editable starting values of a re-base, in the preview's order: goals, emergency fund, free savings, loans. */
export function rebaseFields(rebase: RebasePlan, loans: readonly Loan[], loanLabel: (id: string) => string): RebaseField[] {
  const loanIds = new Set(loans.map((l) => l.id));
  return [
    ...rebase.goalUpdates.map(({ id, draft }) => ({ key: `goal:${id}`, label: `Épargne ${draft.name}`, read: draft.alreadySaved })),
    { key: "emergency", label: "Fonds d’urgence", read: rebase.settings.emergencyExisting },
    { key: "free", label: "Épargne libre", read: rebase.settings.freeSavingsExisting ?? 0 },
    ...rebase.loanUpdates.map(({ id, draft }) => ({ key: `loan:${id}`, label: loanLabel(id), read: draft.principal })),
    ...rebase.loansToArchive.filter((id) => loanIds.has(id)).map((id) => ({ key: `loan:${id}`, label: loanLabel(id), read: 0 })),
  ];
}

/**
 * The re-base with the values corrected by hand (#100), and the list of corrections to record on the
 * check-in. A loan corrected to 0 € is archived like a repaid one (an overdraft stays); a loan the
 * check-in read at 0 € but corrected above it is updated instead of archived.
 */
export function applyRebaseCorrections(
  rebase: RebasePlan,
  loans: readonly Loan[],
  values: Readonly<Record<string, Cents>>,
  loanLabel: (id: string) => string,
): RebasePlan & { corrections: RebaseCorrection[] } {
  const fields = rebaseFields(rebase, loans, loanLabel);
  const used = (key: string, read: Cents) => values[key] ?? read;
  const corrections = fields.flatMap((f) => (used(f.key, f.read) !== f.read ? [{ label: f.label, read: f.read, used: used(f.key, f.read) }] : []));

  const settings = {
    ...rebase.settings,
    emergencyExisting: used("emergency", rebase.settings.emergencyExisting),
    freeSavingsExisting: used("free", rebase.settings.freeSavingsExisting ?? 0),
  };
  const goalUpdates = rebase.goalUpdates.map(({ id, draft }) => ({ id, draft: { ...draft, alreadySaved: used(`goal:${id}`, draft.alreadySaved) } }));

  const byId = new Map(loans.map((l) => [l.id, l]));
  const loanUpdates: RebasePlan["loanUpdates"] = [];
  const loansToArchive: string[] = [];
  const place = (id: string, principal: Cents, draft: LoanDraft | null) => {
    const loan = byId.get(id);
    if (principal === 0 && loan?.kind !== "overdraft") loansToArchive.push(id);
    else if (draft) loanUpdates.push({ id, draft: { ...draft, principal } });
    else if (loan) loanUpdates.push({ id, draft: loanDraft(loan, principal, rebase.fromMonth) });
  };
  for (const { id, draft } of rebase.loanUpdates) place(id, used(`loan:${id}`, draft.principal), draft);
  for (const id of rebase.loansToArchive) place(id, used(`loan:${id}`, 0), null);

  return { ...rebase, settings, goalUpdates, loanUpdates, loansToArchive, corrections };
}
