"use client";

import { CalendarClock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useFinance } from "@/components/app/finance-provider";
import { useIsMobile } from "@/components/app/use-is-mobile";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type CheckInRow, checkInRows } from "@/lib/domain/actual-lines";
import { type PotBalances, balancesByMonth, monthsNotEntered, plannedDeposits, startingBalances } from "@/lib/domain/deposits";
import { lastOpenMonth, openingOf } from "@/lib/domain/payday";
import { verdictOf } from "@/lib/domain/verdict";
import { planRebase } from "@/lib/domain/rebase";
import type { ActualForm } from "@/lib/domain/validation";
import { type ActualStatus, addMonths, compareMonths } from "@/lib/engine";
import { currentDate, currentYearMonth, formatDate, formatMonthLong } from "@/lib/format";
import { ActualVsPlannedCard } from "./actual-vs-planned";
import { CheckInForm } from "./check-in-form";
import { MobileCheckIn } from "./mobile-check-in";
import { History, HistoryList } from "./history";
import { IncomePaymentsCard } from "./income-payments-card";
import { LineActualsCard } from "./line-actuals-card";
import {
  type PlannedValues,
  buildHistory,
  checkInMonths,
  depositValues,
  earlyLoanBalances,
  parseMonthParam,
  pendingCheckIns,
  plannedForMonth,
  prefillForm,
} from "./logic";
import { RebaseCard } from "./rebase-card";

const TITLE = "Suivi mensuel";
const DESCRIPTION = "En fin de mois, reportez vos soldes réels. L’écart avec le plan s’affiche pendant la saisie.";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function SuiviView() {
  const { snapshot, plan } = useFinance();
  const monthParam = useSearchParams().get("mois");
  const isMobile = useIsMobile();

  if (!plan || !snapshot.settings) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <Onboarding hasBudget={snapshot.settings !== null} loanCount={snapshot.loans.length} />
      </>
    );
  }

  const { startMonth } = snapshot.settings;
  const today = currentDate();
  const calendarMonth = currentYearMonth();
  // The next month opens once its first income is paid (SPEC D29): it is then the newest open month.
  const currentMonth = lastOpenMonth(calendarMonth, today, snapshot.lines, snapshot.incomePayments);
  const earlyMonth = currentMonth !== calendarMonth ? currentMonth : null;
  const nextMonth = addMonths(calendarMonth, 1);
  const nextOpening = openingOf(snapshot.lines, nextMonth, snapshot.incomePayments);
  // After "Recaler le plan" the start month can be next month: the history stays visible.
  const notStarted = compareMonths(startMonth, currentMonth) > 0;
  const hasActuals = snapshot.actuals.length > 0;

  const months = notStarted ? [] : checkInMonths(startMonth, currentMonth);
  const entered = snapshot.actuals.map((a) => a.month);
  const actualsByMonth = new Map(snapshot.actuals.map((a) => [a.month, a]));
  const values: Record<string, ActualForm> = {};
  const planned: Record<string, PlannedValues | null> = {};
  const rows: Record<string, CheckInRow[]> = {};
  // Savings goals (SPEC D23): one field each, in priority order.
  const goals = snapshot.goals;
  // Savings are entered as deposits; the balances are computed (SPEC D33).
  const balances = months[0] ? balancesByMonth(plan.result, snapshot.settings, goals, snapshot.actuals, months[0]) : new Map();
  const start = startingBalances(snapshot.settings, goals);
  const total = (b: PotBalances) => goals.reduce((s, g) => s + (b.goals[g.id] ?? 0), 0) + b.emergency + b.free;
  for (const month of months) {
    rows[month] = checkInRows(snapshot.lines, snapshot.exceptions, snapshot.settings, month);
    const actual = actualsByMonth.get(month);
    const before = balances.get(addMonths(month, -1)) ?? start;
    const deposits = plannedDeposits(plan.result, snapshot.settings, goals, month);
    values[month] = {
      ...prefillForm(month, actual, snapshot.loans, goals, rows[month]),
      ...depositValues(actual, goals, before, balances.get(month)),
    };
    const monthPlan = plannedForMonth(plan.result, startMonth, month, goals);
    planned[month] = monthPlan && {
      ...monthPlan,
      deposits: { goals: goals.map((g) => deposits.goals[g.id] ?? 0), emergency: deposits.emergency, free: deposits.free },
      savingsBefore: total(before),
      savingsInterest: balances.get(month)?.interest ?? 0,
      notEntered: monthsNotEntered(snapshot.settings, snapshot.actuals, month),
    };
  }
  // An early month's loans are not entered: the plan's balances after its payment (SPEC D29).
  if (earlyMonth && values[earlyMonth]) {
    values[earlyMonth] = {
      ...values[earlyMonth],
      loanBalances: earlyLoanBalances(plan.result, startMonth, earlyMonth, snapshot.loans.map((l) => l.id)),
    };
  }
  const statuses: Record<string, ActualStatus | null> = Object.fromEntries(plan.comparisons.map((c) => [c.month, c.status]));
  // ?mois= (sidebar, dashboard), else the oldest month still to enter, else the current month.
  const initialMonth =
    parseMonthParam(monthParam, months) ?? pendingCheckIns(startMonth, currentMonth, entered)[0] ?? months[0];
  const loans = snapshot.loans.map((loan, j) => ({
    id: loan.id,
    label: plan.result.loans[j]?.displayName ?? loan.name ?? `Crédit ${j + 1}`,
  }));
  const loanLabels = Object.fromEntries(loans.map((l) => [l.id, l.label]));
  const history = buildHistory(plan.comparisons, snapshot.actuals);

  // Phones: `?mois=` (Saisir, the home shortcut) opens the full-screen check-in flow (#110).
  const mobileMonth = isMobile && !notStarted ? parseMonthParam(monthParam, months) : null;

  // The flow alone: the page below cannot be used meanwhile (and two forms would repeat the fields).
  if (mobileMonth) {
    return (
      <MobileCheckIn
        key={`${startMonth}-${mobileMonth}`}
        month={mobileMonth}
        values={values}
        existing={entered}
        earlyMonth={earlyMonth}
        budgetLines={snapshot.lines}
        rows={rows}
        bankCsvMapping={snapshot.bankCsvMapping ?? null}
        bankRules={snapshot.bankRules ?? []}
        bankAccounts={snapshot.bankAccounts ?? []}
        planned={planned}
        loans={loans}
        goals={goals.map((g) => ({ id: g.id, label: g.name }))}
      />
    );
  }

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_23.75rem]">
        {notStarted ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock aria-hidden className="size-5 shrink-0" />
                <h2>Le suivi n’a pas encore commencé</h2>
              </CardTitle>
              <CardDescription>
                Votre plan démarre en {formatMonthLong(startMonth)}. Les saisies mensuelles seront possibles à partir de ce
                mois-là.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card className="overflow-visible">
            <CardContent className="md:px-7">
              <CheckInForm
                key={`${startMonth}-${monthParam ?? ""}`}
                months={months}
                initialMonth={initialMonth}
                values={values}
                existing={entered}
                statuses={statuses}
                verdicts={Object.fromEntries(snapshot.actuals.map((a) => [a.month, verdictOf(a)?.kind ?? null]))}
                currentMonth={calendarMonth}
                earlyMonth={earlyMonth}
                budgetLines={snapshot.lines}
                rows={rows}
                bankCsvMapping={snapshot.bankCsvMapping ?? null}
                bankRules={snapshot.bankRules ?? []}
                bankAccounts={snapshot.bankAccounts ?? []}
                planned={planned}
                loans={loans}
                goals={goals.map((g) => ({ id: g.id, label: g.name }))}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-4">
          {/* Payment dates of the incomes (SPEC D29): next month first, then the open months. */}
          <IncomePaymentsCard
            months={earlyMonth ? months : [nextMonth, ...months]}
            lines={snapshot.lines}
            payments={snapshot.incomePayments}
            today={today}
            footer={(month) =>
              month === nextMonth && nextOpening ? (
                <p className="rounded-[10px] bg-secondary px-3 py-2.5 text-[13px] leading-normal text-muted-foreground">
                  {nextOpening.date <= today
                    ? `${capitalize(formatMonthLong(nextMonth))} est ouvert au suivi depuis le ${formatDate(nextOpening.date)} (${nextOpening.line.label}).`
                    : `${capitalize(formatMonthLong(nextMonth))} s’ouvrira au suivi le ${formatDate(nextOpening.date)} (${nextOpening.line.label}), dès le premier revenu versé.`}
                </p>
              ) : null
            }
          />
          {notStarted && !hasActuals ? null : (
            <section aria-labelledby="suivi-history-title" className="flex flex-col gap-3.5 rounded-2xl border bg-card p-4 md:p-6">
              <h2 id="suivi-history-title" className="text-[17px] font-semibold">
                Historique
              </h2>
              <HistoryList months={months} entries={history} currentMonth={currentMonth} />
              <p className="rounded-[10px] bg-secondary px-3 py-2.5 text-[13px] leading-normal text-muted-foreground">
                Écart dettes vert si ≤ +10 €, écart épargne vert si ≥ −10 €. Les deux verts : dans les temps ; les deux
                rouges : en retard ; sinon mitigé.
              </p>
            </section>
          )}
          <RebaseCard
            preview={planRebase(snapshot, plan)}
            startMonth={startMonth}
            loanLabels={loanLabels}
            loans={snapshot.loans}
            undo={snapshot.rebaseUndo ?? null}
          />
        </div>
      </div>

      <ActualVsPlannedCard comparisons={plan.comparisons} />

      {snapshot.actuals.some((a) => a.lines.length > 0) ? (
        <LineActualsCard actuals={snapshot.actuals} />
      ) : null}

      {history.length > 0 ? (
        <section aria-labelledby="suivi-detail-title" className="flex min-w-0 flex-col gap-4">
          <h2 id="suivi-detail-title" className="text-[17px] font-semibold">
            Détail des saisies
          </h2>
          <History entries={history} />
        </section>
      ) : null}
    </>
  );
}
