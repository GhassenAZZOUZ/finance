"use client";

import { FileUp, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getRepository } from "@/lib/data/client-store";
import type { BudgetCategory, BudgetLine } from "@/lib/domain/types";
import { type Cents, type YearMonth, isLineActive } from "@/lib/engine";
import { reportError } from "@/lib/errors";
import { formatDate, formatEuros, formatMonthLong } from "@/lib/format";
import {
  type Assignment,
  type BankTransaction,
  type CsvMapping,
  type IgnoredRow,
  checkCsvFile,
  decodeCsv,
  detectSeparator,
  guessMapping,
  isRevolut,
  parseCsv,
  readMapped,
  readRevolut,
  sameHeader,
  totalsOf,
  transactionsOfMonth,
} from "@/lib/import/bank-csv";

const CATEGORY_GROUP: Record<BudgetCategory, string> = {
  income: "Revenus",
  fixed: "Charges fixes",
  variable: "Dépenses variables",
};

type Stage =
  | { kind: "idle" }
  | { kind: "mapping"; rows: string[][]; mapping: CsvMapping }
  | {
      kind: "preview";
      transactions: BankTransaction[];
      assignments: Assignment[];
      outside: number;
      ignored: IgnoredRow[];
      /** To save once the import is confirmed (not for Revolut, which needs none). */
      mapping: CsvMapping | null;
    };

/**
 * « Importer mon relevé » (issue #38, SPEC D30): the bank's CSV is read in the browser, its month's
 * transactions are sorted into budget lines by hand, and the totals pre-fill the check-in's income
 * and expenses. Nothing but the column mapping is saved.
 */
export function BankImport({
  month,
  lines,
  savedMapping,
  onApply,
}: {
  month: YearMonth;
  lines: BudgetLine[];
  savedMapping: CsvMapping | null;
  onApply: (totals: { income: Cents; expenses: Cents }) => void;
}) {
  const id = useId();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const active = lines.filter((l) => isLineActive(l, month));
  const categoryOf = (lineId: string) => lines.find((l) => l.id === lineId)?.category;
  const firstOf = (category: BudgetCategory) => active.find((l) => l.category === category)?.id ?? null;

  function preview(transactions: BankTransaction[], ignored: IgnoredRow[], mapping: CsvMapping | null) {
    const { inMonth, outside } = transactionsOfMonth(transactions, month);
    // A first guess the user corrects: money in → first income line, money out → first variable line.
    const assignments = inMonth.map((t) => (t.amount >= 0 ? firstOf("income") : (firstOf("variable") ?? firstOf("fixed"))));
    setStage({ kind: "preview", transactions: inMonth, assignments, outside, ignored, mapping });
  }

  async function read(file: File) {
    setError(null);
    const problem = checkCsvFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    const text = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    const separator = detectSeparator(text);
    const rows = parseCsv(text, separator);
    if (rows.length < 2) {
      setError("Aucune opération dans ce fichier : vérifiez qu’il s’agit bien de l’export CSV de votre banque.");
      return;
    }
    const header = rows[0]!;
    if (isRevolut(header)) {
      const { transactions, ignored } = readRevolut(rows);
      preview(transactions, ignored, null);
    } else if (savedMapping && sameHeader(savedMapping, header)) {
      const { transactions, ignored } = readMapped(rows, savedMapping);
      preview(transactions, ignored, null);
    } else {
      setStage({ kind: "mapping", rows, mapping: guessMapping(header, separator, rows.slice(1, 6)) });
    }
  }

  function confirm(current: Extract<Stage, { kind: "preview" }>) {
    onApply(totalsOf(current.transactions, current.assignments, categoryOf));
    if (current.mapping) {
      void getRepository()
        .setBankCsvMapping(current.mapping)
        .catch((e: unknown) => reportError(e, "bankCsv.mapping"));
    }
    setStage({ kind: "idle" });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-divider pt-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-file`}>Importer le relevé CSV de {formatMonthLong(month)}</Label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,.txt,text/csv"
          className="text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:bg-background file:px-3"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void read(file).catch((readError: unknown) => {
              reportError(readError, "bankCsv.read");
              setError("Ce fichier n’a pas pu être lu.");
            });
            e.target.value = "";
          }}
        />
        <p className="text-[13px] text-muted-foreground">
          Lu dans votre navigateur : aucune opération n’est envoyée ni enregistrée, seuls les totaux sont reportés. Revolut est
          reconnu automatiquement ; pour une autre banque, indiquez une fois ses colonnes.
        </p>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {stage.kind === "mapping" ? (
        <MappingStep
          stage={stage}
          onChange={(mapping) => setStage({ ...stage, mapping })}
          onCancel={() => setStage({ kind: "idle" })}
          onContinue={() => {
            const { transactions, ignored } = readMapped(stage.rows, stage.mapping);
            preview(transactions, ignored, stage.mapping);
          }}
        />
      ) : null}

      {stage.kind === "preview" ? (
        <PreviewStep
          month={month}
          stage={stage}
          lines={active}
          totals={totalsOf(stage.transactions, stage.assignments, categoryOf)}
          onAssign={(i, lineId) => setStage({ ...stage, assignments: stage.assignments.map((a, j) => (j === i ? lineId : a)) })}
          onCancel={() => setStage({ kind: "idle" })}
          onConfirm={() => confirm(stage)}
        />
      ) : null}
    </div>
  );
}

function MappingStep({
  stage,
  onChange,
  onCancel,
  onContinue,
}: {
  stage: Extract<Stage, { kind: "mapping" }>;
  onChange: (mapping: CsvMapping) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const id = useId();
  const { mapping, rows } = stage;
  const header = rows[0]!;
  const split = mapping.amount === null;
  const column = (name: "date" | "label" | "amount" | "debit" | "credit", label: string, optional = false) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${id}-${name}`}>{label}</Label>
      <select
        id={`${id}-${name}`}
        value={mapping[name] === null ? "" : String(mapping[name])}
        onChange={(e) => onChange({ ...mapping, [name]: e.target.value === "" ? null : Number(e.target.value) })}
        className="h-10 rounded-md border bg-background px-2 text-sm"
      >
        {optional ? <option value="">(aucune)</option> : null}
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h.trim() || `Colonne ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border p-3">
      <legend className="px-1 text-sm font-semibold">Colonnes de votre relevé</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {column("date", "Date")}
        {column("label", "Libellé")}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={split}
              className="size-4 accent-primary"
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? { ...mapping, amount: null, debit: mapping.amount ?? 0, credit: null }
                    : { ...mapping, amount: mapping.debit ?? mapping.credit ?? 0, debit: null, credit: null },
                )
              }
            />
            Débit et crédit dans deux colonnes séparées
          </label>
        </div>
        {split ? (
          <>
            {column("debit", "Débit", true)}
            {column("credit", "Crédit", true)}
          </>
        ) : (
          column("amount", "Montant (négatif = dépense)")
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-decimal`}>Séparateur décimal</Label>
          <select
            id={`${id}-decimal`}
            value={mapping.decimal}
            onChange={(e) => onChange({ ...mapping, decimal: e.target.value as CsvMapping["decimal"] })}
            className="h-10 rounded-md border bg-background px-2 text-sm"
          >
            <option value=",">Virgule : 1 234,56</option>
            <option value=".">Point : 1,234.56</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-dates`}>Format des dates</Label>
          <select
            id={`${id}-dates`}
            value={mapping.dateFormat}
            onChange={(e) => onChange({ ...mapping, dateFormat: e.target.value as CsvMapping["dateFormat"] })}
            className="h-10 rounded-md border bg-background px-2 text-sm"
          >
            <option value="dmy">JJ/MM/AAAA</option>
            <option value="ymd">AAAA-MM-JJ</option>
          </select>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">Ces colonnes seront réutilisées pour les prochains relevés de la même banque.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-10" onClick={onContinue}>
          Continuer
        </Button>
        <Button type="button" variant="ghost" className="min-h-10" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </fieldset>
  );
}

function PreviewStep({
  month,
  stage,
  lines,
  totals,
  onAssign,
  onCancel,
  onConfirm,
}: {
  month: YearMonth;
  stage: Extract<Stage, { kind: "preview" }>;
  lines: BudgetLine[];
  totals: { income: Cents; expenses: Cents };
  onAssign: (index: number, lineId: Assignment) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const count = stage.transactions.length;
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-xl border p-3">
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        {count === 0 ? `Aucune opération en ${formatMonthLong(month)}` : `${count} opération${count > 1 ? "s" : ""} en ${formatMonthLong(month)}`}
      </h3>
      {stage.outside > 0 || stage.ignored.length > 0 ? (
        <details className="text-[13px] text-muted-foreground">
          <summary className="cursor-pointer">
            {[
              stage.outside > 0 ? `${stage.outside} hors du mois` : null,
              stage.ignored.length > 0 ? `${stage.ignored.length} ignorée${stage.ignored.length > 1 ? "s" : ""}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {stage.ignored.map((r) => (
              <li key={r.line}>
                Ligne {r.line}
                {r.label ? ` (${r.label})` : ""} : {r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {count > 0 ? (
        <ul className="flex flex-col divide-y divide-divider">
          {stage.transactions.map((t, i) => (
            <li key={t.line} className="grid gap-2 py-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem_12rem] sm:items-center">
              <span className="text-[13px] text-muted-foreground tabular-nums">{formatDate(t.date)}</span>
              <span className="break-words text-sm">{t.label}</span>
              <span className={`text-right text-sm tabular-nums ${t.amount >= 0 ? "text-good" : ""}`}>{formatEuros(t.amount)}</span>
              <span>
                <Label htmlFor={`${id}-a${i}`} className="sr-only">
                  Ligne de budget pour {t.label} ({formatEuros(t.amount)})
                </Label>
                <select
                  id={`${id}-a${i}`}
                  value={stage.assignments[i] ?? ""}
                  onChange={(e) => onAssign(i, e.target.value === "" ? null : e.target.value)}
                  className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Ignoré (virement interne, crédit…)</option>
                  {(["income", "fixed", "variable"] as const).map((category) => (
                    <optgroup key={category} label={CATEGORY_GROUP[category]}>
                      {lines
                        .filter((l) => l.category === category)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p role="status" className="rounded-[10px] bg-secondary px-3 py-2 text-sm tabular-nums">
        Revenus {formatEuros(totals.income)} · Dépenses {formatEuros(totals.expenses)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-10" onClick={onConfirm} disabled={count === 0}>
          <FileUp aria-hidden className="size-4" />
          Reporter dans le suivi
        </Button>
        <Button type="button" variant="ghost" className="min-h-10" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </section>
  );
}
