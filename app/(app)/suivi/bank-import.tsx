"use client";

import { ArrowLeftRight, FileUp, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import type { BankAccount, BankStatement, BudgetCategory, BudgetLine } from "@/lib/domain/types";
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
  totalsOf,
  transactionsOfMonth,
} from "@/lib/import/bank-csv";
import { type BankRule, learnRules, lineTotals, matchRule } from "@/lib/import/bank-rules";
import {
  type AccountRef,
  type TransferPair,
  MAX_STATEMENTS_PER_MONTH,
  accountOf,
  isDuplicate,
  legKey,
  mappingFor,
  pairKey,
  pairTransfers,
  statementFingerprint,
  statementTotals,
} from "@/lib/import/statements";

const CATEGORY_GROUP: Record<BudgetCategory, string> = {
  income: "Revenus",
  fixed: "Charges fixes",
  variable: "Dépenses variables",
};

const NEW_ACCOUNT = "__new__";

/** A statement read in this import, not reported yet. Its transactions live in the browser only. */
interface Loaded {
  fileName: string;
  account: AccountRef;
  accountName: string;
  transactions: BankTransaction[];
  assignments: Assignment[];
  /** Pre-assigned by a rule (SPEC D31), until the user changes it. */
  proposed: boolean[];
  outside: number;
  ignored: IgnoredRow[];
  fingerprint: string;
  /** Mapping checked in this import, saved to the account once reported (null: Revolut or reused). */
  mapping: CsvMapping | null;
}

type MappingStage = { rows: string[][]; mapping: CsvMapping; fileName: string; account: AccountRef; accountName: string };

/**
 * « Importer mon relevé » (issues #38, #63, #115; SPEC D30/D31): each bank's CSV is read in the
 * browser into one of the user's named accounts, its month's transactions sorted into budget lines,
 * and several statements can be read together, transfers between them proposed and ignored. Reported
 * statements **add** their totals per line to the check-in rows and are listed, each removable.
 * Saved: the accounts and their mappings, the rules, and with the check-in each statement's summary.
 */
export function BankImport({
  month,
  lines,
  accounts = [],
  legacyMapping = null,
  rules = [],
  statements = [],
  onApply,
  onRemove,
}: {
  month: YearMonth;
  lines: BudgetLine[];
  /** The user's bank accounts, each with its column mapping (#115). */
  accounts?: BankAccount[];
  /** The one mapping saved per user before #115: offered to a new account with the same header. */
  legacyMapping?: CsvMapping | null;
  /** Keyword rules learnt from previous imports (SPEC D31). */
  rules?: BankRule[];
  /** The month's statements already added to the rows (saved or not yet). */
  statements?: BankStatement[];
  /** Statements to add to the rows: their totals per line are added (#115). */
  onApply: (added: BankStatement[]) => void;
  /** Removes the statement at this index, its amounts subtracted from the rows. */
  onRemove: (index: number) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<string>(accounts[0]?.id ?? NEW_ACCOUNT);
  const [newName, setNewName] = useState("");
  const [batch, setBatch] = useState<Loaded[]>([]);
  const [mappingStage, setMappingStage] = useState<MappingStage | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "yes" | "no">>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = lines.filter((l) => isLineActive(l, month));
  const categoryOf = (lineId: string) => lines.find((l) => l.id === lineId)?.category;
  const firstOf = (category: BudgetCategory) => active.find((l) => l.category === category)?.id ?? null;
  // An account deleted meanwhile (other tab) falls back to « Nouveau compte ».
  const chosen = accounts.find((a) => a.id === choice) ?? null;

  const pairs = pairTransfers(batch.map((b) => ({ account: b.account, transactions: b.transactions })));
  const confirmedLegs = new Set(
    pairs.filter((p) => decisions[pairKey(p)] === "yes").flatMap((p) => [legKey(p.out), legKey(p.in)]),
  );
  /** Assignments with the confirmed transfers' legs ignored (AC-04). */
  const effective = (b: Loaded, s: number): Assignment[] =>
    b.assignments.map((a, i) => (confirmedLegs.has(legKey({ statement: s, index: i })) ? null : a));

  /** The account the next file goes into, or an error message. */
  function target(): { account: AccountRef; accountName: string } | string {
    if (chosen) return { account: { id: chosen.id }, accountName: chosen.name };
    const name = newName.trim();
    if (name === "") return "Nommez le compte de ce relevé (ex. « Compte courant », « Revolut »).";
    if (name.length > 60) return "Nom du compte : 60 caractères maximum.";
    if (accounts.some((a) => a.name.trim().toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) {
      return `Le compte « ${name} » existe déjà : choisissez-le dans la liste.`;
    }
    return { account: { name }, accountName: name };
  }

  function add(fileName: string, to: { account: AccountRef; accountName: string }, read: { transactions: BankTransaction[]; ignored: IgnoredRow[] }, mapping: CsvMapping | null) {
    const { inMonth, outside } = transactionsOfMonth(read.transactions, month);
    if (inMonth.length === 0) {
      setError(`Aucune opération de ${formatMonthLong(month)} dans « ${fileName} ».`);
      return;
    }
    const fingerprint = statementFingerprint(inMonth);
    const known = [
      ...statements.map((s) => ({ account: accountOf(s), fingerprint: s.fingerprint })),
      ...batch.map((b) => ({ account: b.account, fingerprint: b.fingerprint })),
    ];
    if (isDuplicate(known, to.account, fingerprint)) {
      setError(`Ce relevé est déjà importé dans « ${to.accountName} » pour ${formatMonthLong(month)} : les montants ne changent pas.`);
      return;
    }
    // A rule proposes its line (D31); otherwise a first guess the user corrects: money in → first
    // income line, money out → first variable line.
    const activeIds = new Set(active.map((l) => l.id));
    const matches = inMonth.map((t) => matchRule(t.label, rules));
    const proposed = matches.map((r) => r !== undefined && (r.budgetLineId === null || activeIds.has(r.budgetLineId)));
    const assignments = inMonth.map((t, i) =>
      proposed[i] ? matches[i]!.budgetLineId : t.amount >= 0 ? firstOf("income") : (firstOf("variable") ?? firstOf("fixed")),
    );
    setBatch((b) => [...b, { fileName, ...to, transactions: inMonth, assignments, proposed, outside, ignored: read.ignored, fingerprint, mapping }]);
  }

  async function read(file: File) {
    setError(null);
    const problem = checkCsvFile(file);
    if (problem) return setError(problem);
    if (statements.length + batch.length >= MAX_STATEMENTS_PER_MONTH) {
      return setError(`${MAX_STATEMENTS_PER_MONTH} relevés au maximum par mois.`);
    }
    const to = target();
    if (typeof to === "string") return setError(to);
    const text = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    const separator = detectSeparator(text);
    const rows = parseCsv(text, separator);
    if (rows.length < 2) {
      return setError("Aucune opération dans ce fichier : vérifiez qu’il s’agit bien de l’export CSV de votre banque.");
    }
    const header = rows[0]!;
    if (isRevolut(header)) return add(file.name, to, readRevolut(rows), null);
    // Each account keeps its own mapping (AC-03): reused when the header matches, asked once otherwise.
    const saved = mappingFor(chosen, header, legacyMapping);
    if (saved) return add(file.name, to, readMapped(rows, saved), chosen?.mapping === saved ? null : saved);
    setMappingStage({ rows, mapping: guessMapping(header, separator, rows.slice(1, 6)), fileName: file.name, ...to });
  }

  function cancel() {
    setBatch([]);
    setDecisions({});
    setMappingStage(null);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const repo = getRepository();
    // New accounts are created once (several files may go into the same new account); a mapping
    // checked in this import is saved to its account.
    const ids = new Map<string, string>();
    try {
      for (const b of batch) {
        if ("id" in b.account) {
          if (b.mapping) await repo.updateBankAccount(b.account.id, { mapping: b.mapping });
          continue;
        }
        const key = b.account.name.toLocaleLowerCase("fr");
        if (!ids.has(key)) ids.set(key, (await repo.createBankAccount(b.account.name, b.mapping)).id);
      }
    } catch (saveError) {
      reportError(saveError, "bankCsv.account");
      setError("Le compte n’a pas pu être enregistré : rien n’a été reporté. Réessayez dans un instant.");
      setBusy(false);
      notifyDataChanged();
      return;
    }
    const added = batch.map((b, s): BankStatement => {
      const assignments = effective(b, s);
      return {
        accountId: "id" in b.account ? b.account.id : ids.get(b.account.name.toLocaleLowerCase("fr"))!,
        accountName: b.accountName,
        fileName: b.fileName.slice(0, 255),
        fingerprint: b.fingerprint,
        transactionCount: b.transactions.length,
        ...statementTotals(b.transactions),
        lineTotals: lineTotals(b.transactions, assignments, categoryOf),
      };
    });
    onApply(added);
    const learnt = learnRules(
      batch.flatMap((b) => b.transactions),
      batch.flatMap((b, s) => effective(b, s)),
    );
    cancel();
    setNewName("");
    try {
      await repo.saveBankRules(learnt);
    } catch (saveError) {
      reportError(saveError, "bankCsv.save");
      setError("Les montants ont été reportés, mais les règles d’affectation n’ont pas été enregistrées.");
    }
    setBusy(false);
    notifyDataChanged();
  }

  async function removeRule(rule: BankRule) {
    try {
      await getRepository().deleteBankRule(rule.id);
      notifyDataChanged();
    } catch (deleteError) {
      reportError(deleteError, "bankCsv.rule");
      setError("La règle n’a pas été supprimée. Réessayez dans un instant.");
    }
  }

  const combined = batch.reduce(
    (sum, b, s) => {
      const t = totalsOf(b.transactions, effective(b, s), categoryOf);
      return { income: sum.income + t.income, expenses: sum.expenses + t.expenses };
    },
    { income: 0, expenses: 0 },
  );

  return (
    <div className="flex flex-col gap-3 border-t border-divider pt-3">
      {statements.length > 0 ? (
        <section aria-labelledby={`${id}-statements`} className="flex flex-col gap-1.5">
          <h3 id={`${id}-statements`} className="text-sm font-semibold">
            Relevés importés pour {formatMonthLong(month)}
          </h3>
          <ul className="flex flex-col divide-y divide-divider rounded-xl border">
            {statements.map((s, i) => (
              <li key={`${s.fingerprint}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {s.accountName} <span className="font-normal text-muted-foreground">· {s.fileName}</span>
                  </span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {s.transactionCount} opération{s.transactionCount > 1 ? "s" : ""} · entrées {formatEuros(s.totalIn)} · sorties{" "}
                    {formatEuros(s.totalOut)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-10"
                  onClick={() => onRemove(i)}
                  aria-label={`Retirer le relevé « ${s.fileName} » (${s.accountName})`}
                >
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted-foreground">
            Retirer un relevé soustrait ses montants des lignes ; enregistrez le mois pour confirmer.
          </p>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-account`}>Compte du relevé</Label>
          <select
            id={`${id}-account`}
            value={chosen ? chosen.id : NEW_ACCOUNT}
            onChange={(e) => setChoice(e.target.value)}
            className="h-10 rounded-md border bg-background px-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value={NEW_ACCOUNT}>Nouveau compte…</option>
          </select>
        </div>
        {chosen ? null : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-new-account`}>Nom du nouveau compte</Label>
            <input
              id={`${id}-new-account`}
              value={newName}
              maxLength={60}
              placeholder="ex. Compte courant, Revolut"
              onChange={(e) => setNewName(e.target.value)}
              className="h-10 rounded-md border bg-background px-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-file`}>
          {batch.length > 0 ? `Ajouter un autre relevé de ${formatMonthLong(month)}` : `Importer le relevé CSV de ${formatMonthLong(month)}`}
        </Label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,.txt,text/csv"
          disabled={busy || mappingStage !== null}
          className="text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:bg-background file:px-3"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void read(file).catch((readError: unknown) => {
                reportError(readError, "bankCsv.read");
                setError("Ce fichier n’a pas pu être lu.");
              });
            e.target.value = "";
          }}
        />
        <p className="text-[13px] text-muted-foreground">
          Lu dans votre navigateur : aucune opération n’est envoyée ni enregistrée, seuls les totaux sont reportés. Un relevé par
          compte ; importez ensemble ceux du mois pour repérer les virements entre vos comptes. Revolut est reconnu
          automatiquement ; pour une autre banque, indiquez une fois ses colonnes.
        </p>
      </div>

      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {mappingStage ? (
        <MappingStep
          stage={mappingStage}
          onChange={(mapping) => setMappingStage({ ...mappingStage, mapping })}
          onCancel={() => setMappingStage(null)}
          onContinue={() => {
            const { rows, mapping, fileName, account, accountName } = mappingStage;
            setMappingStage(null);
            add(fileName, { account, accountName }, readMapped(rows, mapping), mapping);
          }}
        />
      ) : null}

      {batch.length > 0 ? (
        <section aria-labelledby={`${id}-batch`} className="flex flex-col gap-3 rounded-xl border p-3">
          <h3 id={`${id}-batch`} className="text-sm font-semibold">
            {batch.length === 1 ? "1 relevé à reporter" : `${batch.length} relevés à reporter`}
          </h3>
          {pairs.length > 0 ? (
            <Transfers pairs={pairs} batch={batch} decisions={decisions} onDecide={(key, d) => setDecisions((x) => ({ ...x, [key]: d }))} />
          ) : null}
          {batch.map((b, s) => (
            <PreviewStep
              key={`${b.fingerprint}-${s}`}
              month={month}
              loaded={b}
              statement={s}
              locked={confirmedLegs}
              lines={active}
              onAssign={(i, lineId) =>
                setBatch((all) =>
                  all.map((x, j) =>
                    j === s
                      ? {
                          ...x,
                          assignments: x.assignments.map((a, k) => (k === i ? lineId : a)),
                          proposed: x.proposed.map((p, k) => (k === i ? false : p)),
                        }
                      : x,
                  ),
                )
              }
            />
          ))}
          <p role="status" className="rounded-[10px] bg-secondary px-3 py-2 text-sm tabular-nums">
            Revenus {formatEuros(combined.income)} · Dépenses {formatEuros(combined.expenses)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-10" onClick={() => void confirm()} disabled={busy}>
              <FileUp aria-hidden className="size-4" />
              {busy ? "Report…" : "Reporter dans le suivi"}
            </Button>
            <Button type="button" variant="ghost" className="min-h-10" onClick={cancel} disabled={busy}>
              Annuler
            </Button>
          </div>
        </section>
      ) : null}

      {accounts.length > 0 ? <Accounts accounts={accounts} onError={setError} /> : null}

      {rules.length > 0 ? (
        <details className="text-sm">
          <summary className="flex min-h-10 cursor-pointer items-center text-muted-foreground">Règles apprises ({rules.length})</summary>
          <ul className="flex flex-col gap-1 pb-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-2">
                <span>
                  « {rule.keyword} » → {lines.find((l) => l.id === rule.budgetLineId)?.label ?? "Ignoré"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-10"
                  onClick={() => void removeRule(rule)}
                  aria-label={`Supprimer la règle « ${rule.keyword} »`}
                >
                  Supprimer
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Proposed transfers between the user's accounts (AC-04): both legs ignored once confirmed. */
function Transfers({
  pairs,
  batch,
  decisions,
  onDecide,
}: {
  pairs: TransferPair[];
  batch: Loaded[];
  decisions: Record<string, "yes" | "no">;
  onDecide: (key: string, decision: "yes" | "no") => void;
}) {
  const leg = (s: number, i: number) => ({ statement: batch[s]!, t: batch[s]!.transactions[i]! });
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-warning-border bg-warning-bg px-3 py-2.5 text-sm">
      <p className="flex items-center gap-2 font-medium text-warning">
        <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
        Virements entre vos comptes ?
      </p>
      <ul className="flex flex-col gap-2">
        {pairs.map((p) => {
          const key = pairKey(p);
          const from = leg(p.out.statement, p.out.index);
          const to = leg(p.in.statement, p.in.index);
          const decision = decisions[key];
          const text = `${formatEuros(p.amount)} de « ${from.statement.accountName} » (${formatDate(from.t.date)}) vers « ${to.statement.accountName} » (${formatDate(to.t.date)})`;
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="tabular-nums">
                {text}
                {decision === "yes" ? " : virement entre vos comptes, ignoré" : decision === "no" ? " : compté normalement" : ""}
              </span>
              {decision ? (
                <Button type="button" variant="ghost" className="min-h-10" onClick={() => onDecide(key, decision === "yes" ? "no" : "yes")}>
                  {decision === "yes" ? "Compter normalement" : "C’est un virement"}
                </Button>
              ) : (
                <span className="flex gap-1.5">
                  <Button type="button" className="min-h-10" onClick={() => onDecide(key, "yes")} aria-label={`Confirmer le virement : ${text}`}>
                    Confirmer
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-10" onClick={() => onDecide(key, "no")} aria-label={`Ce n’est pas un virement : ${text}`}>
                    Non
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Accounts are renamed and deleted where they are used (AC-07); the check-ins keep their amounts. */
function Accounts({ accounts, onError }: { accounts: BankAccount[]; onError: (message: string) => void }) {
  const id = useId();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function rename() {
    if (!editing) return;
    const name = editing.name.trim();
    if (name === "" || name.length > 60) return onError("Nom du compte : de 1 à 60 caractères.");
    if (accounts.some((a) => a.id !== editing.id && a.name.trim().toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) {
      return onError(`Le compte « ${name} » existe déjà.`);
    }
    try {
      await getRepository().updateBankAccount(editing.id, { name });
      setEditing(null);
      notifyDataChanged();
    } catch (saveError) {
      reportError(saveError, "bankCsv.renameAccount");
      onError("Le compte n’a pas été renommé. Réessayez dans un instant.");
    }
  }

  async function remove(account: BankAccount) {
    try {
      await getRepository().deleteBankAccount(account.id);
      setDeleting(null);
      notifyDataChanged();
    } catch (deleteError) {
      reportError(deleteError, "bankCsv.deleteAccount");
      onError("Le compte n’a pas été supprimé. Réessayez dans un instant.");
    }
  }

  return (
    <details className="text-sm">
      <summary className="flex min-h-10 cursor-pointer items-center text-muted-foreground">Vos comptes ({accounts.length})</summary>
      <ul className="flex flex-col gap-1 pb-2">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            {editing?.id === a.id ? (
              <>
                <Label htmlFor={`${id}-${a.id}`} className="sr-only">
                  Nouveau nom de « {a.name} »
                </Label>
                <input
                  id={`${id}-${a.id}`}
                  value={editing.name}
                  maxLength={60}
                  autoFocus
                  onChange={(e) => setEditing({ id: a.id, name: e.target.value })}
                  className="h-10 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                />
                <span className="flex gap-1.5">
                  <Button type="button" className="min-h-10" onClick={() => void rename()}>
                    Enregistrer
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-10" onClick={() => setEditing(null)}>
                    Annuler
                  </Button>
                </span>
              </>
            ) : deleting === a.id ? (
              <>
                <span>Supprimer « {a.name} » ? Les montants déjà reportés sont conservés.</span>
                <span className="flex gap-1.5">
                  <Button type="button" variant="destructive" className="min-h-10" onClick={() => void remove(a)}>
                    Supprimer le compte
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-10" onClick={() => setDeleting(null)}>
                    Garder
                  </Button>
                </span>
              </>
            ) : (
              <>
                <span>
                  {a.name}
                  <span className="text-muted-foreground">{a.mapping ? " · colonnes enregistrées" : ""}</span>
                </span>
                <span className="flex gap-1.5">
                  <Button type="button" variant="ghost" className="min-h-10" onClick={() => setEditing({ id: a.id, name: a.name })} aria-label={`Renommer « ${a.name} »`}>
                    Renommer
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-10" onClick={() => setDeleting(a.id)} aria-label={`Supprimer « ${a.name} »`}>
                    Supprimer
                  </Button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function MappingStep({
  stage,
  onChange,
  onCancel,
  onContinue,
}: {
  stage: MappingStage;
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
      <legend className="px-1 text-sm font-semibold">Colonnes du relevé « {stage.accountName} »</legend>
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
      <p className="text-[13px] text-muted-foreground">Ces colonnes seront réutilisées pour les prochains relevés de ce compte.</p>
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
  loaded,
  statement,
  locked,
  lines,
  onAssign,
}: {
  month: YearMonth;
  loaded: Loaded;
  statement: number;
  /** Legs of confirmed transfers: ignored, not editable. */
  locked: ReadonlySet<string>;
  lines: BudgetLine[];
  onAssign: (index: number, lineId: Assignment) => void;
}) {
  const id = useId();
  const count = loaded.transactions.length;
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2 border-t border-divider pt-2 first-of-type:border-t-0">
      <h4 id={`${id}-title`} className="text-sm font-semibold">
        {loaded.accountName} · {loaded.fileName} : {count} opération{count > 1 ? "s" : ""} en {formatMonthLong(month)}
      </h4>
      {loaded.outside > 0 || loaded.ignored.length > 0 ? (
        <details className="text-[13px] text-muted-foreground">
          <summary className="cursor-pointer">
            {[
              loaded.outside > 0 ? `${loaded.outside} hors du mois` : null,
              loaded.ignored.length > 0 ? `${loaded.ignored.length} ignorée${loaded.ignored.length > 1 ? "s" : ""}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {loaded.ignored.map((r) => (
              <li key={r.line}>
                Ligne {r.line}
                {r.label ? ` (${r.label})` : ""} : {r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ul className="flex flex-col divide-y divide-divider">
        {loaded.transactions.map((t, i) => {
          const transfer = locked.has(legKey({ statement, index: i }));
          return (
            <li key={t.line} className="grid gap-2 py-2 sm:grid-cols-[5.5rem_minmax(0,1fr)_7rem_12rem] sm:items-center">
              <span className="text-[13px] text-muted-foreground tabular-nums">{formatDate(t.date)}</span>
              <span className="break-words text-sm">
                {t.label}
                {loaded.proposed[i] && !transfer ? <span className="ml-2 rounded-full border px-1.5 text-xs text-muted-foreground">proposé</span> : null}
              </span>
              <span className={`text-right text-sm tabular-nums ${t.amount >= 0 ? "text-good" : ""}`}>{formatEuros(t.amount as Cents)}</span>
              <span>
                <Label htmlFor={`${id}-a${i}`} className="sr-only">
                  Ligne de budget pour {t.label} ({formatEuros(t.amount)})
                </Label>
                {transfer ? (
                  <span id={`${id}-a${i}`} className="text-[13px] text-muted-foreground">
                    Virement entre vos comptes
                  </span>
                ) : (
                  <select
                    id={`${id}-a${i}`}
                    value={loaded.assignments[i] ?? ""}
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
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
