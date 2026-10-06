"use client";

import { Bell, CalendarCheck, CircleHelp, Download, FlaskConical, type LucideIcon, Moon, ShieldCheck, Table2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId } from "react";
import { LockSetting } from "@/components/app/app-lock";
import { useFinance } from "@/components/app/finance-provider";
import { DATA_HREF } from "@/components/app/nav";
import { useSignOut } from "@/components/app/sign-out-button";
import { CompactThemeToggle } from "@/components/app/theme-toggle";
import { useTour } from "@/components/app/tour";
import { cn } from "@/lib/utils";

/** Tailwind's `md`: from there the sidebar holds all of this. */
const DESKTOP_QUERY = "(min-width: 48rem)";

const ROW = "flex min-h-14 w-full items-center gap-3.5 px-3.5 text-left text-[15px]";
const ROW_FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

const TOOLS: RowLink[] = [
  { href: "/plan", label: "Plan mois par mois", icon: Table2 },
  { href: "/simuler", label: "Et si… ?", hint: "simuler un changement", icon: FlaskConical },
  { href: "/suivi#suivi-history-title", label: "Historique du suivi", icon: CalendarCheck },
];

const DATA: RowLink[] = [
  { href: DATA_HREF, label: "Exporter / sauvegarder", icon: Download },
  { href: "/import", label: "Importer le classeur", icon: Upload },
  { href: DATA_HREF, label: "Rappel mensuel", icon: Bell },
  { href: "/confidentialite/", label: "Confidentialité", icon: ShieldCheck },
];

interface RowLink {
  href: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden className="flex size-8.5 shrink-0 items-center justify-center rounded-[10px] bg-muted">
      <Icon className="size-4.5" />
    </span>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className="flex flex-col gap-2.5">
      {title ? (
        <h2 id={id} className="mx-1 mt-2 text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {title}
        </h2>
      ) : null}
      <ul className="divide-y divide-border/60 overflow-hidden rounded-[18px] border bg-card">{children}</ul>
    </section>
  );
}

function LinkRows({ rows }: { rows: RowLink[] }) {
  return rows.map(({ href, label, hint, icon }) => (
    <li key={label}>
      <Link href={href} className={cn(ROW, ROW_FOCUS)}>
        <RowIcon icon={icon} />
        <span className="grow">
          {label}
          {hint ? <span className="text-[13px] text-muted-foreground"> · {hint}</span> : null}
        </span>
      </Link>
    </li>
  ));
}

/**
 * « Plus » (mobile only, issue #108): what the 5-tab bar leaves out (account, Plan, Et si… ?,
 * data, theme, guide, sign-out). On a desktop-wide window the sidebar has all of it: back to `/`.
 */
export function PlusView() {
  const { email } = useFinance();
  const router = useRouter();
  const tour = useTour();
  const signOut = useSignOut();
  const themeLabelId = useId();
  const initial = email?.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const leave = () => {
      if (media.matches) router.replace("/");
    };
    leave();
    media.addEventListener("change", leave);
    return () => media.removeEventListener("change", leave);
  }, [router]);

  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="mb-1.5 font-heading text-[32px] leading-none font-medium">Plus</h1>

      <div className="flex items-center gap-3.5 rounded-[18px] border bg-card p-3.5">
        <span aria-hidden className="flex size-11.5 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-semibold">
          {initial}
        </span>
        <span className="flex min-w-0 flex-col">
          <b className="text-base font-semibold">Compte</b>
          <span className="truncate text-[13px] text-muted-foreground">{email ?? ""}</span>
        </span>
      </div>

      <Group title="Outils">
        <LinkRows rows={TOOLS} />
      </Group>

      <Group title="Mes données">
        <LinkRows rows={DATA} />
      </Group>

      <Group title="Préférences">
        <li className={ROW}>
          <RowIcon icon={Moon} />
          <span id={themeLabelId} className="grow">
            Thème
          </span>
          <CompactThemeToggle labelledBy={themeLabelId} />
        </li>
        <LockSetting className={ROW} />
        <li>
          <button type="button" onClick={tour.start} className={cn(ROW, ROW_FOCUS)}>
            <RowIcon icon={CircleHelp} />
            <span className="grow">Revoir la visite guidée</span>
          </button>
        </li>
      </Group>

      <div className="mt-2">
        <Group>
          <li>
            <button type="button" onClick={signOut} className={cn(ROW, ROW_FOCUS, "font-medium text-destructive")}>
              Se déconnecter
            </button>
          </li>
        </Group>
      </div>
    </div>
  );
}
