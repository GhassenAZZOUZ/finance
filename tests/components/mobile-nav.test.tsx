/** Mobile tab bar (issue #108): 5 tabs, « Saisir » to the oldest pending month with its count, « Plus » for the rest. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileHeader, MobileNav } from "@/components/app/nav";
import { currentYearMonth } from "@/lib/format";

const mocks = vi.hoisted(() => ({ pathname: "/", pending: [] as string[] }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/components/app/finance-provider", () => ({
  useOptionalFinance: () => ({
    email: "a@example.test",
    snapshot: { settings: { startMonth: "2026-07" }, lines: [], incomePayments: [], actuals: [] },
  }),
}));
vi.mock("@/app/(app)/suivi/logic", () => ({ pendingCheckIns: () => mocks.pending, pendingMonthsText: () => "" }));

beforeEach(() => {
  mocks.pathname = "/";
  mocks.pending = [];
});
afterEach(cleanup);

const nav = () => screen.getByRole("navigation", { name: "Navigation principale" });
const tab = (name: RegExp) => within(nav()).getByRole("link", { name });
const current = () => within(nav()).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");

describe("MobileNav", () => {
  it("has 5 tabs in order, Saisir in the centre", () => {
    render(<MobileNav />);
    const names = within(nav())
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(names).toEqual(["Accueil", "Budget", "Saisir", "Crédits", "Plus"]);
    expect(tab(/Accueil/).getAttribute("href")).toBe("/");
    expect(tab(/Budget/).getAttribute("href")).toBe("/budget");
    expect(tab(/Crédits/).getAttribute("href")).toBe("/credits");
    expect(tab(/Plus/).getAttribute("href")).toBe("/plus");
  });

  it("opens the oldest pending month and shows the count", () => {
    mocks.pending = ["2026-08", "2026-09"];
    render(<MobileNav />);
    const saisir = tab(/Saisir/);
    expect(saisir.getAttribute("href")).toBe("/suivi?mois=2026-08");
    expect(saisir.textContent).toContain("2");
    expect(saisir.textContent).toContain("(2 mois à saisir)");
  });

  it("opens the current month, without a badge, when nothing is pending", () => {
    render(<MobileNav />);
    const saisir = tab(/Saisir/);
    expect(saisir.getAttribute("href")).toBe(`/suivi?mois=${currentYearMonth()}`);
    expect(saisir.textContent).toBe("Saisir");
  });

  it("caps the badge at 99+", () => {
    mocks.pending = Array.from({ length: 120 }, (_, i) => `m${i}`);
    render(<MobileNav />);
    expect(tab(/Saisir/).textContent).toContain("99+");
  });

  it.each([
    ["/", "Accueil"],
    ["/budget", "Budget"],
    ["/suivi", "Saisir"],
    ["/credits", "Crédits"],
    ["/plus", "Plus"],
    ["/plan", "Plus"],
    ["/simuler", "Plus"],
    ["/donnees", "Plus"],
    ["/import", "Plus"],
  ])("on %s the active tab is %s", (pathname, label) => {
    mocks.pathname = pathname;
    render(<MobileNav />);
    expect(current().map((l) => l.textContent?.replace(/\d.*$/, ""))).toEqual([label]);
  });

  it("carries the tour targets of the pages it groups", () => {
    render(<MobileNav />);
    expect(tab(/Saisir/).getAttribute("data-tour")).toBe("nav:/suivi");
    expect(tab(/Plus/).getAttribute("data-tour")?.split(" ")).toEqual(["nav:/plan", "nav:/simuler", "donnees", "guide"]);
  });
});

describe("MobileHeader", () => {
  it("shows the brand on the home only, without an account menu", () => {
    render(<MobileHeader />);
    expect(screen.getByText("Boussole")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    mocks.pathname = "/budget";
    render(<MobileHeader />);
    expect(screen.queryByText("Boussole")).toBeNull();
  });
});
