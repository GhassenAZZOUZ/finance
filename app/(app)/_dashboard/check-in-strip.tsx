/** Recent monthly check-ins strip. */
import Link from "next/link";
import { ArrowLink, checkInHref } from "@/components/app/nav";
import { STATUS_TONE } from "@/components/app/tones";
import type { YearMonth } from "@/lib/engine";
import { formatMonthLong } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { ToneText } from "./kpi";
import { type CheckInSlot, formatSignedEuros } from "./logic";
import { CARD } from "./styles";

export function CheckInStripCard({ slots, startMonth }: { slots: CheckInSlot[]; startMonth: YearMonth }) {
  return (
    <section aria-labelledby="suivi-title" className={cn(CARD, "flex flex-col gap-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="suivi-title" className="text-base font-semibold md:text-[17px]">
          Suivi réel
        </h2>
        <ArrowLink href="/suivi">Historique</ArrowLink>
      </div>
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Le suivi commence en {formatMonthLong(startMonth)}.</p>
      ) : (
        <ol className="grid gap-2.5 sm:grid-cols-3">
          {slots.map((slot) => (
            <CheckInTile key={slot.month} slot={slot} />
          ))}
        </ol>
      )}
    </section>
  );
}

function CheckInTile({ slot }: { slot: CheckInSlot }) {
  const monthName = <span className="text-[13px] text-muted-foreground first-letter:uppercase">{formatMonthLong(slot.month)}</span>;
  const status = slot.comparison?.status ?? null;
  if (slot.state === "entered") {
    const c = slot.comparison!;
    return (
      <li className={cn("flex flex-col gap-1.5 rounded-xl border p-3.5", status ? STATUS_TONE[status].tile : "bg-secondary")}>
        {monthName}
        {status ? (
          <ToneText tone={status === "onTrack" ? "good" : status === "mixed" ? "warning" : "bad"} className="text-sm font-semibold">
            {STATUS_LABEL[status]}
          </ToneText>
        ) : (
          <span className="text-sm font-semibold">Saisi</span>
        )}
        {c.debtGap !== null && c.savingsGap !== null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            écarts : dette {formatSignedEuros(c.debtGap)} · épargne {formatSignedEuros(c.savingsGap)}
          </span>
        ) : null}
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-dashed border-input p-3.5">
      {monthName}
      <span className="text-sm font-semibold">{slot.state === "current" ? "En cours" : "À saisir"}</span>
      {slot.state === "current" ? (
        <span className="text-xs text-muted-foreground">à saisir en fin de mois</span>
      ) : (
        <Link
          href={checkInHref(slot.month)}
          className="text-xs font-medium text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Saisir {formatMonthLong(slot.month)} →
        </Link>
      )}
    </li>
  );
}
