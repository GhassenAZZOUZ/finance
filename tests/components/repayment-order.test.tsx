/** Dashboard « Ordre de remboursement »: the penalties paid by the plan are shown (issue #9, AC-08). */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RepaymentOrder } from "@/app/(app)/_dashboard/repayment-order";
import { computePlan } from "@/lib/domain/plan";
import { formatEuros } from "@/lib/format";
import { makeLoan, makeSettings, makeSnapshot } from "./helpers";

const plan = (penaltyPct: number | null) =>
  computePlan(
    makeSnapshot({
      settings: makeSettings({ startMonth: "2026-01", emergencyTarget: 0, emergencyExisting: 0, riskFreeRate: 0.01, earlyRepaymentPct: 1 }),
      lines: [{ id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null }],
      goals: [],
      loans: [makeLoan(1, { apr: 0.08, penaltyPct })],
    }),
    "2026-01",
  )!;

afterEach(cleanup);

describe("RepaymentOrder", () => {
  it("AC-08 (#9) — states the total penalties paid next to the interest saved", () => {
    const withPenalty = plan(0.03);
    const { penaltiesPaid, interestSaved } = withPenalty.result.kpis;
    expect(penaltiesPaid).toBeGreaterThan(0);
    render(<RepaymentOrder plan={withPenalty} />);
    const text = screen.getByText(/d’intérêts économisés grâce au plan/).textContent!.replace(/\s/g, " ");
    expect(text).toBe(`${formatEuros(interestSaved)} d’intérêts économisés grâce au plan, net de ${formatEuros(penaltiesPaid)} d’IRA`.replace(/\s/g, " "));
  });

  it("says nothing about penalties when there are none", () => {
    render(<RepaymentOrder plan={plan(null)} />);
    expect(screen.getByText(/d’intérêts économisés grâce au plan/).textContent).not.toContain("IRA");
  });
});
