"use client";

import { CheckCircle2, FileSpreadsheet, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useRef, useState } from "react";
import { useFinance } from "@/components/app/finance-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import type { BudgetCategory } from "@/lib/domain/types";
import { errorMessage, reportError } from "@/lib/errors";
import { formatEuros, formatMonthLong, formatPercent } from "@/lib/format";
import { planImport } from "@/lib/import/apply";
import { type CellError, type TemplateData, readTemplateFile } from "@/lib/import/template";

type State =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "rejected"; message: string }
  | { status: "invalid"; fileName: string; errors: CellError[] }
  | { status: "preview"; fileName: string; data: TemplateData }
  | { status: "saving"; fileName: string; data: TemplateData }
  | { status: "saveFailed"; fileName: string; data: TemplateData; message: string }
  | { status: "done"; lines: number; loans: number };

const CATEGORY_TITLE: Record<BudgetCategory, string> = {
  income: "Revenus",
  fixed: "Charges fixes",
  variable: "Dépenses variables",
};

/**
 * Template import (issue #8): the file is read in the browser, previewed, and saved only after
 * « Importer ». Cell errors block the import; cancelling writes nothing.
 */
export function ImportView() {
  const { snapshot } = useFinance();
  const [state, setState] = useState<State>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setState({ status: "reading" });
    const result = await readTemplateFile(file);
    if (result.ok) setState({ status: "preview", fileName: file.name, data: result.data });
    else if (result.kind === "file") setState({ status: "rejected", message: result.message });
    else setState({ status: "invalid", fileName: file.name, errors: result.errors });
  }

  function reset() {
    setState({ status: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function confirm(fileName: string, data: TemplateData) {
    setState({ status: "saving", fileName, data });
    try {
      const repo = getRepository();
      // Plan against what is saved now, not the page's copy.
      await repo.applyImport(planImport(await repo.load(), data));
      notifyDataChanged();
      setState({ status: "done", lines: data.lines.length, loans: data.loans.length });
    } catch (error) {
      reportError(error, "import.apply");
      // All-or-nothing: a failed import changed nothing, so there is nothing to reload.
      setState({ status: "saveFailed", fileName, data, message: errorMessage(error, "Réessayez dans un instant.") });
    }
  }

  const replaced = { hadSettings: snapshot.settings !== null, lines: snapshot.lines.length, loans: snapshot.loans.length };
  const busy = state.status === "reading" || state.status === "saving";

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 md:gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Fichier</h2>
          </CardTitle>
          <CardDescription>
            Le classeur « plan_financier » (.xlsx, 5 Mo maximum), onglets « Budget » et « Crédits » remplis. Il est lu dans votre
            navigateur et n’est jamais envoyé.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <label htmlFor={inputId} className="font-medium">
            Choisir le classeur
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="min-h-11 max-w-full text-sm file:mr-3 file:min-h-10 file:rounded-[10px] file:border file:border-input file:bg-card file:px-4 file:font-medium hover:file:bg-secondary"
          />
          {state.status === "reading" ? <p role="status">Lecture du fichier…</p> : null}
          {state.status === "rejected" ? <ErrorBox>{state.message}</ErrorBox> : null}
        </CardContent>
      </Card>

      {state.status === "invalid" ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Erreurs dans « {state.fileName} »</h2>
            </CardTitle>
            <CardDescription>Corrigez ces cellules dans le classeur puis choisissez-le à nouveau. Rien n’a été importé.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <ul role="alert" className="flex flex-col gap-1.5">
              {state.errors.map((e, i) => (
                <li key={i} className="flex gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-bad">
                  <span className="shrink-0 font-medium tabular-nums">
                    {e.sheet}
                    {e.cell ? `!${e.cell}` : ""}
                  </span>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {state.status === "preview" || state.status === "saving" || state.status === "saveFailed" ? (
        <Preview data={state.data} fileName={state.fileName}>
          {replaced.hadSettings || replaced.loans > 0 ? (
            <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-warning">
              L’import <strong>remplace</strong> vos paramètres, vos {replaced.lines} lignes de budget et vos {replaced.loans} crédits
              actifs (un crédit déjà utilisé dans le suivi est archivé). Vos saisies de suivi et vos mois exceptionnels sont conservés.
            </p>
          ) : null}
          {state.status === "saveFailed" ? (
            <ErrorBox>L’import a échoué : rien n’a été modifié. {state.message}</ErrorBox>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11 md:min-h-9"
              disabled={state.status === "saving"}
              onClick={() => void confirm(state.fileName, state.data)}
            >
              {state.status === "saving" ? "Import…" : "Importer"}
            </Button>
            <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={state.status === "saving"} onClick={reset}>
              Annuler
            </Button>
          </div>
        </Preview>
      ) : null}

      {state.status === "done" ? (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-good-border bg-good-bg px-3 py-2 text-sm font-medium text-good">
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          Import terminé : paramètres, {state.lines} lignes de budget et {state.loans} crédits.
          <Link href="/" className="underline underline-offset-4">
            Voir le tableau de bord
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-bad">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Preview({ data, fileName, children }: { data: TemplateData; fileName: string; children: ReactNode }) {
  const s = data.settings;
  const params: [string, string][] = [
    ["Début du plan", formatMonthLong(s.startMonth)],
    ["Objectif déménagement", formatEuros(s.movingGoal)],
    ["Date limite déménagement", formatMonthLong(s.movingDeadlineMonth)],
    ["Déjà épargné (déménagement)", formatEuros(s.movingAlreadySaved)],
    ["Fonds d’urgence cible", formatEuros(s.emergencyTarget)],
    ["Épargne de précaution disponible", formatEuros(s.emergencyExisting)],
    ["Taux seuil", formatPercent(s.riskFreeRate)],
    ["Part vers le remboursement anticipé", formatPercent(s.earlyRepaymentPct)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet aria-hidden className="size-5 shrink-0" />
          <h2 className="break-all">Aperçu de « {fileName} »</h2>
        </CardTitle>
        <CardDescription>
          {params.length} paramètres, {data.lines.length} lignes de budget, {data.loans.length} crédits. Rien n’est enregistré avant
          « Importer ».
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <section aria-labelledby="imp-params" className="flex flex-col gap-2">
          <h3 id="imp-params" className="font-medium">
            Paramètres
          </h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {params.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-divider py-1">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {(Object.keys(CATEGORY_TITLE) as BudgetCategory[]).map((category) => {
          const lines = data.lines.filter((l) => l.category === category);
          return (
            <section key={category} aria-labelledby={`imp-${category}`} className="flex flex-col gap-2">
              <h3 id={`imp-${category}`} className="font-medium">
                {CATEGORY_TITLE[category]} ({lines.length})
              </h3>
              <ul className="flex flex-col">
                {lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3 border-b border-divider py-1">
                    <span className="min-w-0 break-words">{l.label}</span>
                    <span className="shrink-0 tabular-nums">{formatEuros(l.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section aria-labelledby="imp-loans" className="flex flex-col gap-2">
          <h3 id="imp-loans" className="font-medium">
            Crédits ({data.loans.length})
          </h3>
          {data.loans.length === 0 ? (
            <p className="text-muted-foreground">Aucun crédit dans le fichier.</p>
          ) : (
            <ul className="flex flex-col">
              {data.loans.map((l, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3 border-b border-divider py-1">
                  <span className="min-w-0 break-words font-medium">{l.name ?? `Crédit ${i + 1}`}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatEuros(l.principal)} · {formatPercent(l.apr)} · {formatEuros(l.monthlyPayment)}/mois
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {children}
      </CardContent>
    </Card>
  );
}
