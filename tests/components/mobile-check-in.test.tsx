/** Mobile check-in (issue #110): 4-step full-screen flow, same action and payload as desktop. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gapLine } from "@/app/(app)/suivi/mobile-check-in";
import { SuiviView } from "@/app/(app)/suivi/view";
import { withPlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const line = (id: string, category: BudgetLine["category"], label: string, amount: number): BudgetLine => ({
  id,
  category,
  label,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});

const mocks = vi.hoisted(() => ({
  value: null as unknown,
  repo: null as RepositoryMock | null,
  mois: "2026-08" as string | null,
  back: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => mocks.value, useOptionalFinance: () => mocks.value }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.mois ? { mois: mocks.mois } : {}),
  useRouter: () => ({ replace: mocks.replace, back: mocks.back, push: vi.fn() }),
  usePathname: () => "/suivi",
}));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: vi.fn() }));

function phone(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: () => {}, removeEventListener: () => {} }) as never;
}

function setup(loans = [makeLoan(1, { name: "Auto" })]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T10:00:00Z"));
  const snapshot: FinanceSnapshot = makeSnapshot({
    settings: makeSettings({ startMonth: "2026-07" }),
    lines: [line("salary", "income", "Salaire", 290_000), line("rent", "fixed", "Loyer", 95_000)],
    loans,
  });
  const loaded = withPlan(snapshot, "2026-09");
  mocks.value = loaded;
  mocks.repo = createRepositoryMock(snapshot);
  render(<SuiviView />);
  return userEvent.setup({ delay: null, advanceTimers: () => {} });
}

const flow = () => screen.getByRole("progressbar", { name: "Progression de la saisie" });
const stepTitle = () => screen.getAllByRole("heading", { level: 2 }).find((h) => !h.closest("[hidden]"))!;
const field = (name: string) => screen.getAllByLabelText(name).find((el) => el.id.startsWith("m-")) as HTMLInputElement;

beforeEach(() => {
  phone(true);
  mocks.mois = "2026-08";
  mocks.back.mockReset();
  mocks.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MobileCheckIn", () => {
  it("AC-01 — 4 steps, forward and back, keeping what was typed", async () => {
    const user = setup();
    expect(flow().getAttribute("aria-valuetext")).toBe("Étape 1 sur 4 : Revenus et dépenses");
    expect(stepTitle().textContent).toBe("Revenus et dépenses de août");
    await user.type(field("Salaire"), "2900");

    await user.click(screen.getByRole("button", { name: "Suivant : épargne" }));
    expect(flow().getAttribute("aria-valuenow")).toBe("2");
    expect(stepTitle().textContent).toBe("Combien avez-vous versé en août ?");
    await user.click(screen.getByRole("button", { name: "Suivant : crédits" }));
    expect(stepTitle().textContent).toBe("Capital restant dû");

    await user.click(screen.getByRole("button", { name: "Précédent" }));
    await user.click(screen.getByRole("button", { name: "Précédent" }));
    expect(stepTitle().textContent).toBe("Revenus et dépenses de août");
    expect(field("Salaire").value).toBe("2900");
  });

  it("AC-02 — « Tout est comme prévu » fills the step with the planned values, conform to the plan", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Suivant : épargne" }));
    const section = screen.getByRole("region", { name: "Combien avez-vous versé en août ?" });
    await user.click(within(section).getByRole("button", { name: "Tout est comme prévu" }));
    for (const input of within(section).getAllByRole("textbox")) expect((input as HTMLInputElement).value).not.toBe("");
    expect(within(section).getAllByText("✓ conforme au plan").length).toBe(within(section).getAllByRole("textbox").length);
  });

  it("an invalid amount blocks « Suivant » with an inline error", async () => {
    const user = setup();
    await user.type(field("Loyer"), "abc");
    await user.click(screen.getByRole("button", { name: "Suivant : épargne" }));
    expect(stepTitle().textContent).toBe("Revenus et dépenses de août");
    expect(field("Loyer").getAttribute("aria-invalid")).toBe("true");
  });

  it("AC-04 — nothing is saved before the last step; then once, with the desktop payload", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: /Tout est comme prévu/, hidden: false }));
    await user.click(screen.getByRole("button", { name: "Suivant : épargne" }));
    await user.click(within(screen.getByRole("region", { name: /versé en août/ })).getByRole("button", { name: "Tout est comme prévu" }));
    await user.click(screen.getByRole("button", { name: "Suivant : crédits" }));
    await user.click(within(screen.getByRole("region", { name: "Capital restant dû" })).getByRole("button", { name: "Tout est comme prévu" }));
    await user.click(screen.getByRole("button", { name: "Suivant : vérifier" }));
    expect(mocks.repo!.saveActual).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Enregistrer août 2026" }));
    await waitFor(() => expect(mocks.repo!.saveActual).toHaveBeenCalledTimes(1));
    const draft = mocks.repo!.saveActual.mock.calls[0]![0];
    expect(draft.month).toBe("2026-08");
    expect(draft.lines.filter((l) => l.kind === "line").map((l) => [l.label, l.actual])).toEqual([
      ["Salaire", 290_000],
      ["Loyer", 95_000],
    ]);
    expect(draft.loanBalances).toHaveLength(1);
    expect(draft.deposits?.length).toBeGreaterThan(0);
    expect(await screen.findByText("Mois de août 2026 enregistré.")).toBeTruthy();
  });

  it("without an active loan, the loans step says so", async () => {
    const user = setup([]);
    await user.click(screen.getByRole("button", { name: "Suivant : épargne" }));
    await user.click(screen.getByRole("button", { name: "Suivant : crédits" }));
    expect(screen.getByText("Aucun crédit actif : rien à saisir.")).toBeTruthy();
  });

  it("AC-05 — × goes back to the previous page, nothing saved", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Fermer la saisie" }));
    expect(mocks.back.mock.calls.length + mocks.replace.mock.calls.length).toBe(1);
    expect(mocks.repo!.saveActual).not.toHaveBeenCalled();
  });

  it("opens only on a phone with ?mois=; /suivi alone and desktop keep the page", () => {
    mocks.mois = null;
    setup();
    expect(screen.queryByRole("progressbar", { name: "Progression de la saisie" })).toBeNull();
    cleanup();
    phone(false);
    mocks.mois = "2026-08";
    setup();
    expect(screen.queryByRole("progressbar", { name: "Progression de la saisie" })).toBeNull();
  });
});

describe("gapLine (AC-03)", () => {
  it("800,00 € planned: 790 is conform, 700 is 100 € under; exactly 10 € is still conform", () => {
    const plain = (text: string | undefined) => (text ?? "").replace(/[  ]/g, " ");
    expect(gapLine(79_000, 80_000, "savings")).toEqual({ text: "✓ conforme au plan", good: true });
    expect(gapLine(81_000, 80_000, "debt")).toEqual({ text: "✓ conforme au plan", good: true });
    const under = gapLine(70_000, 80_000, "savings");
    expect(plain(under?.text)).toBe("↓ 100,00 € sous le plan");
    expect(under?.good).toBe(false);
    // Above the plan: good for savings, bad for a debt.
    expect(gapLine(81_001, 80_000, "savings")?.good).toBe(true);
    const debt = gapLine(81_001, 80_000, "debt");
    expect(plain(debt?.text)).toBe("↑ 10,01 € au-dessus du plan");
    expect(debt?.good).toBe(false);
    expect(gapLine(null, 80_000, "savings")).toBeNull();
  });
});
