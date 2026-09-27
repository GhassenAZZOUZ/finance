"use client";

import { CalendarCheck, CreditCard, LayoutDashboard, Table2, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/", label: "Tableau de bord", short: "Accueil", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", short: "Budget", icon: Wallet },
  { href: "/credits", label: "Crédits", short: "Crédits", icon: CreditCard },
  { href: "/plan", label: "Plan", short: "Plan", icon: Table2 },
  { href: "/suivi", label: "Suivi", short: "Suivi", icon: CalendarCheck },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Top links on desktop. */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="hidden md:block">
      <ul className="flex gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Bottom tab bar on mobile (≥ 44px targets, safe-area aware). */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map(({ href, short, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon aria-hidden className="size-5" strokeWidth={active ? 2.5 : 2} />
                {short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
