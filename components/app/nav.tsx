"use client";

import { ArrowRight, CalendarCheck, CreditCard, FlaskConical, LayoutDashboard, Table2, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { pendingCheckIns, pendingMonthsText } from "@/app/(app)/suivi/logic";
import type { YearMonth } from "@/lib/engine";
import { currentYearMonth, formatMonthLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useOptionalFinance } from "./finance-provider";
import { SignOutButton } from "./sign-out-button";

export const NAV_ITEMS = [
  { href: "/", label: "Tableau de bord", short: "Accueil", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", short: "Budget", icon: Wallet },
  { href: "/credits", label: "Crédits", short: "Crédits", icon: CreditCard },
  { href: "/plan", label: "Plan", short: "Plan", icon: Table2 },
  { href: "/suivi", label: "Suivi", short: "Suivi", icon: CalendarCheck },
  { href: "/simuler", label: "Et si… ?", short: "Simuler", icon: FlaskConical },
] as const;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Check-in months still to enter (oldest first); empty while loading or before the plan. */
export function usePendingCheckIns(): YearMonth[] {
  const finance = useOptionalFinance();
  const settings = finance?.snapshot.settings;
  if (!finance || !settings) return [];
  return pendingCheckIns(
    settings.startMonth,
    currentYearMonth(),
    finance.snapshot.actuals.map((a) => a.month),
  );
}

/** Link to the check-in form of a given month. */
export function checkInHref(month: YearMonth): string {
  return `/suivi?mois=${month}`;
}

/** Logo: a rising line on an ink tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 30" aria-hidden className={cn("size-7.5 shrink-0", className)}>
      <rect width="30" height="30" rx="8" className="fill-primary" />
      <path
        d="M8 20 L13 14 L17 17 L22 10"
        stroke="var(--bucket-moving)"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "2" in an ochre pill; the visible number is repeated in words for screen readers. */
function PendingBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-bucket-moving px-2 text-xs leading-5 font-semibold text-foreground tabular-nums",
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
  const finance = useOptionalFinance();
  const pending = usePendingCheckIns();
  const oldest = pending[0];
  return (
    <aside className="sticky top-0 hidden h-dvh w-62 shrink-0 flex-col gap-8 overflow-y-auto border-r border-sidebar-border bg-sidebar px-4.5 py-7 text-sidebar-foreground md:flex">
      <div className="flex items-center gap-2.5 px-2">
        <BrandMark />
        <span className="font-heading text-xl leading-tight font-semibold text-foreground">Plan financier</span>
      </div>

      <nav aria-label="Navigation principale">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
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

      <div className="flex items-center justify-between gap-2 px-2">
        <span className="min-w-0 truncate text-[13px] text-muted-foreground" title={finance?.email ?? undefined}>
          {finance?.email ?? ""}
        </span>
        <SignOutButton iconOnly />
      </div>
    </aside>
  );
}

/** Mobile top bar (< md): brand and an account menu (email + sign-out). */
export function MobileHeader() {
  const finance = useOptionalFinance();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = finance?.email?.trim().charAt(0).toUpperCase() || "?";

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
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
      <Link href="/" className={cn("flex items-center gap-2 rounded-md", FOCUS_RING)}>
        <BrandMark className="size-6.5" />
        <span className="font-heading text-lg font-semibold">Plan financier</span>
      </Link>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          aria-label="Compte et déconnexion"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((o) => !o)}
          className={cn("flex size-11 items-center justify-center rounded-full", FOCUS_RING)}
        >
          <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-accent text-[13px] font-semibold">
            {initial}
          </span>
        </button>
        <div
          ref={menuRef}
          id={menuId}
          hidden={!open}
          className="absolute top-12 right-0 z-40 flex w-64 flex-col gap-2 rounded-2xl border bg-popover p-3 text-sm shadow-lg"
        >
          {finance?.email ? <p className="truncate px-1 text-muted-foreground">{finance.email}</p> : null}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

/** Bottom tab bar on mobile (≥ 44px targets, safe-area aware). */
export function MobileNav() {
  const pathname = usePathname();
  const pending = usePendingCheckIns();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-6">
        {NAV_ITEMS.map(({ href, short, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "text-foreground before:absolute before:inset-x-[22%] before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-foreground"
                    : "text-muted-foreground",
                )}
              >
                <span className="relative flex">
                  <Icon aria-hidden className="size-5.5" strokeWidth={active ? 2.3 : 2} />
                  {href === "/suivi" ? (
                    <PendingBadge count={pending.length} className="absolute -top-1.5 -right-3 px-1.5 text-[10px] leading-4 font-bold" />
                  ) : null}
                </span>
                {short}
              </Link>
            </li>
          );
        })}
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
