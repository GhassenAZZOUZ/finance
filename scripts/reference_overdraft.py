"""
Independent reference for the overdraft rules (docs/SPEC.md D24, issue #28). The spreadsheet has
no overdraft, so the app's engine is cross-checked against this re-implementation instead of Excel.

Integer cents throughout; rounding = Excel ROUND(x, 2) (reference_engine.xround2).

Usage:
    python scripts/reference_overdraft.py scripts/overdraft_scenarios.json tests/fixtures/overdraft-reference.json
"""
from __future__ import annotations

import json
import sys
from decimal import ROUND_HALF_UP, Decimal

HORIZON = 300


def round_cents(x: float) -> int:
    """ROUND(x, 2) expressed in cents, x being cents: half away from zero on the 15-digit repr."""
    # 15 significant digits first, as Excel (and SPEC §4.0) do.
    d = Decimal(format(float(x), ".15g")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(d)


def cents(euros: float) -> int:
    return round_cents(euros * 100)


def add_months(ym: str, k: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7]) - 1 + k
    y += m // 12
    return f"{y:04d}-{m % 12 + 1:02d}"


def loan_payment(kind: str, due: int, payment: int) -> int:
    if kind == "overdraft":
        return max(0, min(payment, due))
    # Loans: spreadsheet min(), with a residual under 1 EUR added to the payment (D13).
    return due if due - payment < 100 else payment


def simulate(s: dict) -> list[dict]:
    b = s["budget"]
    loans = s["loans"]
    income, expenses = cents(b["income"]), cents(b["expenses"])
    goal, deadline, moving = cents(b["movingGoal"]), b["movingDeadlineMonth"], cents(b["movingAlreadySaved"])
    target, emergency = cents(b["emergencyTarget"]), cents(b["emergencyExisting"])
    rf, pct = b["riskFreeRate"], b["earlyRepaymentPct"]
    kinds = [L.get("kind", "loan") for L in loans]
    apr = [L["apr"] for L in loans]
    pay = [cents(L["monthlyPayment"]) for L in loans]
    limit = [cents(L.get("limit", 0)) for L in loans]
    bal = [cents(L["principal"]) for L in loans]
    base = bal[:]
    # Avalanche order: eligible debts by APR descending, entry order on ties.
    eligible = [(bal[i] > 0 or kinds[i] == "overdraft") and apr[i] > rf for i in range(len(loans))]
    order = sorted([i for i in range(len(loans)) if eligible[i]], key=lambda i: (-apr[i], i))

    out = []
    for m in range(HORIZON):
        month = add_months(b["startMonth"], m)
        interest = [round_cents(bal[i] * apr[i] / 12) for i in range(len(loans))]
        paid = [loan_payment(kinds[i], bal[i] + interest[i], pay[i]) for i in range(len(loans))]
        after = [bal[i] + interest[i] - paid[i] for i in range(len(loans))]
        b_int = [round_cents(base[i] * apr[i] / 12) for i in range(len(loans))]
        # Baseline: loans as the spreadsheet; an overdraft keeps its balance, agios paid each month.
        base = [
            base[i] + b_int[i] - (min(max(pay[i], b_int[i]), base[i] + b_int[i]) if kinds[i] == "overdraft"
                                  else loan_payment(kinds[i], base[i] + b_int[i], pay[i]))
            for i in range(len(loans))
        ]

        available = income - expenses - sum(paid)
        to_moving = max(0, min(available, goal - moving)) if month <= deadline else 0
        moving += to_moving
        to_emergency = max(0, min(available - to_moving, target - emergency))
        emergency += to_emergency
        remainder = max(0, available - to_moving - to_emergency)
        budget_left = round_cents(remainder * pct)
        to_early = budget_left
        early = [0] * len(loans)
        for i in order:
            if budget_left <= 0:
                break
            early[i] = min(after[i], budget_left)
            budget_left -= early[i]
        # Negative month: draw on the overdrafts in entry order, up to their limit.
        shortfall = max(0, -available)
        draw = [0] * len(loans)
        for i in range(len(loans)):
            if shortfall <= 0:
                break
            if kinds[i] != "overdraft":
                continue
            draw[i] = min(max(0, limit[i] - (after[i] - early[i])), shortfall)
            shortfall -= draw[i]
        bal = [after[i] - early[i] + draw[i] for i in range(len(loans))]
        unused = max(0, to_early - sum(early))
        out.append(
            {
                "month": month,
                "available": available,
                "toEarlyRepayment": to_early,
                "unusedEarlyRepayment": unused,
                "overdraftDraw": sum(draw),
                "remainingDebt": sum(bal),
                "totalInterest": sum(interest),
                "loans": [
                    {"interest": interest[i], "paymentPaid": paid[i], "earlyRepayment": early[i], "draw": draw[i],
                     "endBalance": bal[i], "baselineEndBalance": base[i]}
                    for i in range(len(loans))
                ],
            }
        )
    return out


def main(src: str, dst: str) -> None:
    scenarios = json.load(open(src, encoding="utf-8"))
    fixture = {
        "source": "scripts/reference_overdraft.py (independent re-implementation of SPEC D24)",
        "units": "cents",
        "scenarios": [{**s, "expected": simulate(s)} for s in scenarios],
    }
    with open(dst, "w", encoding="utf-8", newline="\n") as f:
        json.dump(fixture, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"{len(scenarios)} scenarios -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
