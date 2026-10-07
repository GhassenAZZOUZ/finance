"use client";

import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  ChevronUp,
  CreditCard,
  Database,
  Ellipsis,
  FlaskConical,
  House,
  LayoutDashboard,
  Plus,
  Table2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { pendingCheckIns, pendingMonthsText } from "@/app/(app)/suivi/logic";
import { type YearMonth, monthsBetween } from "@/lib/engine";
import type { ComputedPlan } from "@/lib/domain/plan";
import { currentDate, currentYearMonth, formatMonthLong, formatMonthShort } from "@/lib/format";
import { lastOpenMonth } from "@/lib/domain/payday";
import { cn } from "@/lib/utils";
import { useOptionalFinance } from "./finance-provider";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { TourButton } from "./tour";

export const NAV_ITEMS = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/credits", label: "Crédits", icon: CreditCard },
  { href: "/plan", label: "Plan", icon: Table2 },
  { href: "/suivi", label: "Suivi", icon: CalendarCheck },
  { href: "/simuler", label: "Et si… ?", icon: FlaskConical },
  { href: "/rapports", label: "Rapports", icon: BarChart3 },
] as const;

/** Export / backup page, reached from the account area (not a main tab). */
export const DATA_HREF = "/donnees";

/** Mobile-only page gathering what the 5-tab bar leaves out (issue #108). */
export const PLUS_HREF = "/plus";

/** Pages reached from « Plus » on mobile: the Plus tab is the active one there. */
const PLUS_PAGES = [PLUS_HREF, "/plan", "/simuler", DATA_HREF, "/import"];

/** Mobile tabs on each side of the central « Saisir » button. */
const MOBILE_TABS_START = [
  { href: "/", label: "Accueil", icon: House },
  { href: "/budget", label: "Budget", icon: Wallet },
] as const;
const MOBILE_TABS_END = [{ href: "/credits", label: "Crédits", icon: CreditCard }] as const;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** « Mes données » and the import page it links to. */
function isDataPage(pathname: string) {
  return isActive(pathname, DATA_HREF) || isActive(pathname, "/import");
}

/** Check-in months still to enter (oldest first); empty while loading or before the plan. */
export function usePendingCheckIns(): YearMonth[] {
  const finance = useOptionalFinance();
  const settings = finance?.snapshot.settings;
  if (!finance || !settings) return [];
  // The next month counts once its first income is paid (SPEC D29).
  const { lines, incomePayments } = finance.snapshot;
  return pendingCheckIns(
    settings.startMonth,
    lastOpenMonth(currentYearMonth(), currentDate(), lines, incomePayments),
    finance.snapshot.actuals.map((a) => a.month),
  );
}

/** Link to the check-in form of a given month. */
export function checkInHref(month: YearMonth): string {
  return `/suivi?mois=${month}`;
}

/** Logo (Boussole): a "€" whose crossbar is a compass needle, ochre tip pointing east. Same as app/icon.svg. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden className={cn("size-7.5 shrink-0", className)}>
      <rect width="120" height="120" rx="28" className="fill-brand-tile" />
      <path d="M85 37 A30 30 0 1 0 85 83" fill="none" stroke="#F3F0E8" strokeWidth="13" strokeLinecap="round" />
      <path d="M100 60 L58 49 L58 71 Z" fill="var(--bucket-moving)" />
      <path d="M16 60 L58 49 L58 71 Z" fill="#F3F0E8" />
    </svg>
  );
}

/** "2" in an ochre pill; the visible number is repeated in words for screen readers. */
function PendingBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-bucket-moving px-2 text-xs leading-5 font-semibold text-on-bucket-moving tabular-nums",
        className,
      )}
    >
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">
        {" "}
        ({count} mois à saisir)
      </span>
    </span>
  );
}

/** Desktop sidebar (≥ md): brand, links, "À faire" card, account. */
export function Sidebar() {
  const pathname = usePathname();
  const pending = usePendingCheckIns();
  const oldest = pending[0];
  return (
    <aside className="sticky top-0 hidden h-dvh w-62 shrink-0 flex-col gap-8 overflow-y-auto border-r border-sidebar-border bg-sidebar px-4.5 py-7 text-sidebar-foreground md:flex print:hidden">
      <div className="flex items-center gap-2.5 px-2">
        <BrandMark />
        <span className="font-heading text-xl leading-tight font-semibold text-foreground">Boussole</span>
      </div>

      <nav aria-label="Navigation principale">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  data-tour={`nav:${href}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors",
                    FOCUS_RING,
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                  <span className="grow">{label}</span>
                  {href === "/suivi" ? <PendingBadge count={pending.length} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="grow" />

      {oldest ? (
        <section
          aria-labelledby="todo-title"
          className="flex flex-col gap-2.5 rounded-[14px] border border-input bg-background p-4"
        >
          <h2 id="todo-title" className="text-[13px] font-medium tracking-wide text-muted-foreground">
            À faire
          </h2>
          <p className="text-[15px] leading-snug font-semibold text-foreground">
            {pending.length} mois de suivi à saisir
          </p>
          <p className="text-[13px] text-muted-foreground first-letter:uppercase">{pendingMonthsText(pending)}</p>
          <Link
            href={checkInHref(oldest)}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90",
              FOCUS_RING,
            )}
          >
            Saisir {formatMonthLong(oldest)}
          </Link>
        </section>
      ) : null}

      <AccountMenu />
    </aside>
  );
}

/** « Sept. 2026 · mois 3 »: the reference month and its rank in the plan (mobile home pill, #109). */
export function monthPill(plan: Pick<ComputedPlan, "referenceMonth" | "input">): string {
  const short = formatMonthShort(plan.referenceMonth);
  return `${short.charAt(0).toUpperCase()}${short.slice(1)} · mois ${monthsBetween(plan.input.budget.startMonth, plan.referenceMonth) + 1}`;
}

/**
 * Small brand header of the mobile home (< md). Other pages have no global header: they start
 * with their own title, and the account lives in « Plus ».
 */
export function MobileHeader() {
  const pathname = usePathname();
  const plan = useOptionalFinance()?.plan;
  if (pathname !== "/") return null;
  return (
    <header className="flex h-15 items-center gap-2.5 px-4 md:hidden print:hidden">
      <BrandMark />
      <span className="font-heading text-xl font-semibold">Boussole</span>
      {/* The reference month and its rank in the plan (#109). */}
      {plan ? (
        <span className="ml-auto rounded-full bg-secondary px-3 py-1.5 text-[13px] font-medium tabular-nums">{monthPill(plan)}</span>
      ) : null}
    </header>
  );
}

/**
 * Sidebar account menu (≥ md): e-mail, « Mes données », the guide, the theme and sign-out, closed
 * by default, opening upwards. Escape or a click outside closes it. On mobile they are in « Plus ».
 */
function AccountMenu() {
  const pathname = usePathname();
  const finance = useOptionalFinance();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const email = finance?.email ?? null;
  const initial = email?.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        // The tour points at « Mes données » and the guide through this button while the menu is closed.
        data-tour="donnees guide"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 rounded-[12px] px-2 text-left text-sm transition-colors hover:bg-sidebar-accent",
          (open || isDataPage(pathname)) && "bg-sidebar-accent",
          FOCUS_RING,
        )}
      >
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-foreground">
          {initial}
        </span>
        <span className="min-w-0 grow">
          <span className="block text-[13px] font-medium text-foreground">Compte</span>
          <span className="block truncate text-[12px] text-muted-foreground" title={email ?? undefined}>
            {email ?? ""}
          </span>
        </span>
        <ChevronUp aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "rotate-180")} />
      </button>
      <div
        ref={menuRef}
        id={menuId}
        hidden={!open}
        // The sidebar is a full-height sticky column that clips its overflow: the menu is pinned to the
        // window corner above the account button rather than inside it.
        className="fixed bottom-24 left-4.5 z-40 flex w-64 flex-col gap-2 rounded-2xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
      >
        <Link
          href={DATA_HREF}
          aria-current={isDataPage(pathname) ? "page" : undefined}
          onClick={() => setOpen(false)}
          className={cn(
            "flex min-h-11 items-center gap-2 rounded-md border border-input px-3 font-medium hover:bg-secondary",
            isDataPage(pathname) && "bg-secondary",
            FOCUS_RING,
          )}
        >
          <Database aria-hidden className="size-4" />
          Mes données
        </Link>
        <TourButton onStart={() => setOpen(false)} className="border border-input text-foreground hover:bg-secondary" />
        <ThemeToggle />
        <SignOutButton />
      </div>
    </div>
  );
}

const TAB_CLASS =
  "flex min-h-[50px] flex-col items-center justify-center gap-[3px] text-[11px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

function tabTone(active: boolean) {
  return active ? "font-semibold text-foreground" : "font-medium text-muted-foreground";
}

function MobileTab({
  href,
  label,
  icon: Icon,
  active,
  tour,
}: {
  href: string;
  label: string;
  icon: typeof House;
  active: boolean;
  tour: string;
}) {
  return (
    <li>
      <Link href={href} data-tour={tour} aria-current={active ? "page" : undefined} className={cn(TAB_CLASS, tabTone(active))}>
        <Icon aria-hidden className="size-[23px]" strokeWidth={active ? 2.3 : 2} />
        {label}
      </Link>
    </li>
  );
}

/**
 * Bottom tab bar on mobile (< md, issue #108): Accueil · Budget · Saisir · Crédits · Plus.
 * « Saisir » is a raised button to the oldest month still to enter (the current month when none),
 * with the pending count; « Plus » covers Plan, Et si… ?, Mes données and the account.
 */
export function MobileNav() {
  const pathname = usePathname();
  const pending = usePendingCheckIns();
  const checkInActive = isActive(pathname, "/suivi");
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card px-1 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)] md:hidden print:hidden"
    >
      <ul className="grid grid-cols-5">
        {MOBILE_TABS_START.map((tab) => (
          <MobileTab key={tab.href} {...tab} active={isActive(pathname, tab.href)} tour={`nav:${tab.href}`} />
        ))}
        <li>
          <Link
            href={checkInHref(pending[0] ?? currentYearMonth())}
            // The tour's « Suivi » step points here on mobile.
            data-tour="nav:/suivi"
            aria-current={checkInActive ? "page" : undefined}
            className={cn(TAB_CLASS, tabTone(checkInActive))}
          >
            <span className="relative -mt-6.5 flex size-14 items-center justify-center rounded-[18px] bg-foreground text-background shadow-[0_6px_16px_rgb(29_28_25/0.28)]">
              <Plus aria-hidden className="size-6.5" strokeWidth={2.4} />
              <PendingBadge
                count={pending.length}
                className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center border-2 border-card px-1 text-[11px] leading-none font-bold"
              />
            </span>
            Saisir
          </Link>
        </li>
        {MOBILE_TABS_END.map((tab) => (
          <MobileTab key={tab.href} {...tab} active={isActive(pathname, tab.href)} tour={`nav:${tab.href}`} />
        ))}
        <MobileTab
          href={PLUS_HREF}
          label="Plus"
          icon={Ellipsis}
          active={PLUS_PAGES.some((href) => isActive(pathname, href))}
          // The tour's Plan, Et si… ?, Mes données and Guide steps point here on mobile.
          tour="nav:/plan nav:/simuler donnees guide"
        />
      </ul>
    </nav>
  );
}

/** Small "→" link used across the pages ("Détail mois par mois →"). */
export function ArrowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap text-link underline-offset-4 hover:underline",
        FOCUS_RING,
        className,
      )}
    >
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}
