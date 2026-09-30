import { CircleCheck, CircleMinus, CircleX } from "lucide-react";
import { VERDICT_LABEL, type Verdict, type VerdictCheck, type VerdictKind } from "@/lib/domain/verdict";
import { formatEuros } from "@/lib/format";
import { STATUS_TONE } from "./tones";

/** Same colours as the trajectory status; the label and the icon carry the meaning (never colour alone). */
const TONE: Record<VerdictKind, keyof typeof STATUS_TONE> = { held: "onTrack", partial: "mixed", missed: "late" };
const ICON = { held: CircleCheck, partial: CircleMinus, missed: CircleX } as const;

/** « Plan tenu » / « Plan partiellement tenu » / « Plan non tenu », or « — (non détaillé) » (SPEC D34). */
export function VerdictBadge({ verdict, pending }: { verdict: Verdict | null; pending?: string }) {
  if (!verdict) return <span className="text-sm text-muted-foreground">{pending ?? "— (non détaillé)"}</span>;
  const tone = STATUS_TONE[TONE[verdict.kind]];
  const Icon = ICON[verdict.kind];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone.badge}`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {VERDICT_LABEL[verdict.kind]}
    </span>
  );
}

const signed = (cents: number) => (cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents));

function CheckLine({ label, check, verb }: { label: string; check: VerdictCheck; verb: string }) {
  return (
    <li className="flex items-start gap-1.5">
      {check.ok ? <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-good" /> : <CircleX aria-hidden className="mt-0.5 size-3.5 shrink-0 text-bad" />}
      <span>
        <span className="sr-only">{check.ok ? "Tenu : " : "Non tenu : "}</span>
        {label} : {formatEuros(check.actual)} pour {formatEuros(check.planned)} {verb} ({signed(check.gap)})
      </span>
    </li>
  );
}

/** The three checks with their amounts and gaps, then where the month drifted. */
export function VerdictDetail({ verdict }: { verdict: Verdict }) {
  return (
    <div className="flex flex-col gap-1.5 text-[13px] tabular-nums">
      <ul className="flex flex-col gap-1">
        <CheckLine label="Dépenses" check={verdict.expenses} verb="prévues" />
        <CheckLine label="Revenus" check={verdict.income} verb="prévus" />
        <CheckLine label="Épargne versée" check={verdict.savings} verb="prévue" />
      </ul>
      {verdict.overspent.length > 0 ? (
        <p className="text-muted-foreground">
          Dépassements : {verdict.overspent.map((l) => `${l.label} (${signed(l.gap)})`).join(", ")}
        </p>
      ) : null}
      {verdict.missedPots.length > 0 ? (
        <p className="text-muted-foreground">
          Versements manqués : {verdict.missedPots.map((p) => `${p.label} (${signed(p.gap)})`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
