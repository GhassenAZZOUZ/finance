"use client";

import { Download, Lock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useFinance } from "@/components/app/finance-provider";
import { VerdictBadge, VerdictDetail } from "@/components/app/verdict-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { openPaywall } from "@/lib/billing/paywall";
import { parseMonth } from "@/lib/domain/validation";
import { verdictOf } from "@/lib/domain/verdict";
import { formatEuros, formatMonthLong } from "@/lib/format";
import { isNativeApp } from "@/lib/native/platform";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { key: "income", title: "Revenus", match: (d: string) => d === "income" },
  { key: "expense", title: "Dépenses", match: (d: string) => d === "expense" },
] as const;

/**
 * Monthly report, Pro (issue #145, US-8; owner decision 2026-10-07): one check-in on a printable
 * page. « Télécharger en PDF » opens the browser's print dialog (« Enregistrer au format PDF »):
 * nothing is generated nor sent elsewhere. The app's menus are hidden when printing.
 */
export function MonthReport() {
  const { snapshot } = useFinance();
  const param = useSearchParams().get("mois") ?? "";
  const parsed = parseMonth(param);
  const actual = parsed.ok ? snapshot.actuals.find((a) => a.month === parsed.value) : undefined;

  if (snapshot.isPro === false) {
    return (
      <section className="flex max-w-2xl flex-col items-start gap-3 rounded-2xl border bg-card p-5">
        <p className="flex items-center gap-2 font-semibold">
          <Lock aria-hidden className="size-4.5" />
          Le rapport mensuel en PDF est réservé à Boussole Pro
        </p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => openPaywall("tags_limit")}>
          Découvrir Boussole Pro
        </Button>
      </section>
    );
  }

  if (!actual) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun suivi enregistré pour ce mois.{" "}
        <Link href="/rapports" className="font-medium text-link underline underline-offset-2">
          Retour aux rapports
        </Link>
      </p>
    );
  }

  const verdict = verdictOf(actual);
  const goalName = (id: string) => snapshot.goals.find((g) => g.id === id)?.name ?? "Objectif supprimé";
  const loanName = (id: string) => [...snapshot.loans, ...snapshot.archivedLoans].find((l) => l.id === id)?.name ?? "Crédit";

  return (
    <article aria-labelledby="month-report-title" className="flex max-w-3xl flex-col gap-5 print:max-w-none print:gap-4 print:text-[12px]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] tracking-[0.06em] text-muted-foreground uppercase">Boussole · rapport mensuel</p>
          <h1 id="month-report-title" className="font-heading text-[32px] leading-tight font-medium first-letter:uppercase">
            {formatMonthLong(actual.month)}
          </h1>
        </div>
        {isNativeApp() ? (
          <p className="max-w-xs text-sm text-muted-foreground print:hidden">Le PDF se télécharge depuis le site web de Boussole.</p>
        ) : (
          <Button type="button" className="min-h-11 print:hidden" onClick={() => window.print()}>
            <Download aria-hidden />
            Télécharger en PDF
          </Button>
        )}
      </header>

      <section aria-label="Verdict du mois" className="flex flex-col gap-2 rounded-2xl border bg-card p-4 print:break-inside-avoid">
        <VerdictBadge verdict={verdict} />
        {verdict ? <VerdictDetail verdict={verdict} /> : null}
        <p className="text-sm tabular-nums">
          Revenus {actual.income === null ? "—" : formatEuros(actual.income)} · Dépenses {actual.expenses === null ? "—" : formatEuros(actual.expenses)}
        </p>
      </section>

      {actual.lines.length > 0 ? (
        SECTIONS.map((section) => {
          const rows = actual.lines.filter((l) => section.match(l.direction));
          if (rows.length === 0) return null;
          return (
            <section key={section.key} aria-label={section.title} className="flex flex-col gap-2 print:break-inside-avoid">
              <h2 className="text-[17px] font-semibold">{section.title}</h2>
              <Table label={`${section.title} : réel et budget`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ligne</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-right">Réel</TableHead>
                    <TableHead className="text-right">Écart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l, i) => {
                    const gap = l.actual - l.planned;
                    const bad = section.key === "expense" ? gap > 1_000 : gap < -1_000;
                    return (
                      <TableRow key={`${l.label}-${i}`}>
                        <TableCell>{l.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatEuros(l.planned)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatEuros(l.actual)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", bad && "font-semibold text-bad")}>
                          {gap > 0 ? "+" : ""}
                          {formatEuros(gap)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">Ce mois a été saisi sans le détail par ligne.</p>
      )}

      <section aria-label="Épargne et crédits" className="grid gap-4 sm:grid-cols-2 print:grid-cols-2 print:break-inside-avoid">
        <div className="flex flex-col gap-1.5 rounded-2xl border bg-card p-4">
          <h2 className="text-[15px] font-semibold">Épargne en fin de mois</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
            {actual.goalBalances.map((b) => (
              <Pair key={b.goalId} label={goalName(b.goalId)} value={b.balance} />
            ))}
            <Pair label="Fonds d’urgence" value={actual.emergencySavings} />
            <Pair label="Épargne libre" value={actual.freeSavings} />
          </dl>
        </div>
        <div className="flex flex-col gap-1.5 rounded-2xl border bg-card p-4">
          <h2 className="text-[15px] font-semibold">Crédits restant dus</h2>
          {actual.loanBalances.length > 0 ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm tabular-nums">
              {actual.loanBalances.map((b) => (
                <Pair key={b.loanId} label={loanName(b.loanId)} value={b.balance} />
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun crédit.</p>
          )}
        </div>
      </section>
    </article>
  );
}

function Pair({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{formatEuros(value)}</dd>
    </>
  );
}
