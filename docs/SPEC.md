# Functional spec: finance plan engine & app rules (V1)

Reference workbook: `docs/plan_financier.template.xlsx`, an **anonymized** copy of the owner's Google
Sheet `plan_financier` with the same formulas and invented values. The owner's real workbook
(`docs/plan_financier.xlsx`) is git-ignored and must never be committed or quoted.

This document is the contract for the TypeScript engine (`lib/engine/`) and the app's business
rules. Cell references (`Sheet!Cell`) trace each rule back to the spreadsheet. §2 lists the V1
decisions, which are the only deliberate deviations from the spreadsheet.

Status: **validated by the owner on 2026-09-27** (decisions in §2).

---

## 0. How this spec was validated

| Check | Result |
|---|---|
| Independent Python re-implementation (`scripts/reference_engine.py --float`) vs every cached value of the original workbook | 21,964 cells, 0 mismatches (max diff 3.4e-12 on full-precision Excel; 6.5e-6 on the Google export, which truncates to 10 digits) |
| Same, on 15 edge-case scenarios recalculated by desktop Excel | 0 mismatches |
| xx.xx rule (§2 D2): Excel recalculation of the template with the `ROUND` patches, vs the reference engine in cents mode | 15 scenarios × 22,208 cells, 0 mismatches (max diff 1.8e-12) |

Golden data: `tests/fixtures/golden.json` (§9) contains **Excel's** computed values, never values
from our code.

---

## 1. Sheets → app mapping

| Sheet | Role | App |
|---|---|---|
| Guide | Instructions | Onboarding / help text |
| Budget | Inputs (income, costs, parameters) | `/budget` |
| Crédits | Up to 6 loans + derived columns | `/credits` |
| Suivi réel | Monthly actuals vs plan | `/suivi` |
| Plan | Month-by-month allocation, 300 months | `/plan` |
| Calcul | Per-loan simulation (plan + baseline) | engine only |
| Synthèse | KPIs + 2 charts + latest actuals status | `/` dashboard |

---

## 2. V1 decisions (owner-validated 2026-09-27)

| # | Topic | Decision |
|---|---|---|
| D1 | Personal data | The real workbook stays local and git-ignored. Fixtures, seeds and docs use invented values only |
| D2 | Money | **xx.xx**: every money value the app stores or computes is a whole number of cents (§4.0) |
| D3 | Dates | `startMonth` and `movingDeadlineMonth` are `YYYY-MM` months. Month granularity everywhere |
| D4 | Personal debts | No special rule. A 0 % personal debt behaves exactly as in the spreadsheet: normal payments only, never eligible for early repayment. "Dette personnelle" is just a loan type label |
| D5 | Remaining months | **Dropped** (the input and its 3 derived columns). Replaced by simulated payoff months and per-loan interest (§5) |
| D21 | Dark theme (issue #11) | The theme follows the OS (`prefers-color-scheme`) by default, live. A « Thème » control (Système / Clair / Sombre: sidebar and mobile account menu) overrides it; Clair / Sombre are stored on the device under `localStorage["finance-theme"]`, « Système » removes the key; any other stored value = Système; blocked storage = the choice lasts for the session. An inline script in `<head>` sets the `.dark` class before the first paint. Every colour is a token in `app/globals.css` with a light and a dark value; text contrast ≥ 4.5:1 in both themes (axe, all pages) |
| D20 | Template import (issue #8) | Page `/import` (from « Mes données »): the `.xlsx` template (≤ 5 MB) is read **in the browser** (no upload, no dependency, no macro or formula executed: cached values only), previewed, and saved only on « Importer ». Cells are validated with the form rules; any error (sheet + cell) blocks the import. Import **replaces** the parameters, the budget lines and the active loans; check-ins and one-off exceptions are kept. Idempotent: line slots (category, rank) and loans (same name, case-insensitive) are reused, active loans absent from the file are removed (archived when check-ins use them, D8). Details in §11 |
| D19 | Installable app (issue #6) | Web app manifest (`app/manifest.ts`): name « Plan financier », `display: standalone`, `start_url` = `scope` = the app root **with the Pages base path** (`/finance/`), icons 192 / 512 / maskable 512, a « Suivi » shortcut; iOS: `apple-touch-icon` + `apple-mobile-web-app-*` tags. No service worker: offline mode is out of scope. On iOS the installed app does not share Safari's storage, so a magic link opened from the mail signs in Safari, not the app (the 6-digit code, #3, fixes this). The monthly e-mail reminder is **not built yet** (needs an e-mail provider) |
| D18 | Export (issue #7) | Page « Mes données » (account area): a versioned **JSON backup** of every input (settings, budget lines, exceptions, active and archived loans, check-ins with frozen values; the plan is not included since it is recomputed) and the **300-month plan as CSV** (French format by default: `;` and decimal comma; international: `,` and dot). Both are built in the browser from a fresh repository load (RLS applies); a failed load downloads nothing. Format in §10 |
| D17 | "Et si…" simulator (issue #2) | A page compares the saved plan with a simulation that is **never saved**: early-repayment %, risk-free threshold and budget line amounts can be changed, and one-off **extra repayments** added (loan, month within the plan, amount > 0). An extra repayment is paid after that month's normal payment and **before** the avalanche (which then works on the reduced balance), capped at the balance left; the simulator refuses a larger amount. Its money comes either from the **free savings** (deducted from `freeSavingsCum` that month, which may then go negative: the UI warns) or from **outside the plan** (bonus, gift: no other effect). The monthly allocation (§6) is unchanged. Not stored and not used by the dashboard: without extra repayments the engine is unchanged (golden data unchanged) |
| D16 | Re-basing the plan (issue #5) | Each check-in stores the planned debt, savings, income and expenses it was compared with, plus the plan's start month (frozen at save time; a re-save keeps them). Comparisons use frozen values when present, so later plan changes never rewrite past gaps. "Recaler le plan" (from the latest check-in M): freezes unfrozen check-ins, sets start month = M+1, moving/emergency/free savings starting amounts = M's balances (new `freeSavingsExisting`, default 0), loan principals = M's balances read after M's payment (D5c), loans at 0 archived |
| D15 | Budget lines with a period (issue #1) | A budget line may have an optional `startMonth` and/or `endMonth` (inclusive, `YYYY-MM`; null = open; end ≥ start). Each month's regular income and expenses are the sums of the lines active that month; one-off exceptions (D14) apply on top. KPIs (monthly income, expenses, margin, debt ratio) describe the **reference month** = the current month kept within the plan (plan start before it starts, month 300 after it ends), and the UI names that month. Lines without a period behave exactly as before (golden data unchanged) |
| D14 | One-off budget exceptions (2026-09-27) | The regular budget applies to every month; `budget_exceptions` add extra income or extra expenses to a single month (label, amount > 0). That month's `income`/`expenses` (and so its allocation) include them; months outside the plan are ignored. KPIs (monthly income, expenses, margin, debt ratio, emergency-fund suggestion) keep describing the regular month. Check-in income/expense gaps compare with that month's budget. Deviation from the spreadsheet (constant budget) |
| D13 | Residual under 1 € (2026-09-27) | When less than 1 € would remain after a normal payment, it is added to that payment (as banks adjust the last instalment), so the loan ends that month. Applies to the plan, the baseline and the D5c projection. Deviation from the spreadsheet, patched into the Excel golden data |
| D5c | Principal read before the plan start (2026-09-27) | Optional `principalPaidThroughMonth` per loan (default in the form: current month). The entered principal is the balance **after the payment of that month**; the app rolls it forward with the normal payments of the months strictly between that month and `startMonth` (§4.5). Empty = principal at the plan start (spreadsheet behaviour). Read after the start → used as is, with a warning |
| D5b | Contract end month (2026-09-27) | Optional `contractEndMonth` (YYYY-MM) per loan, **for a consistency check only**: warning when it differs by more than 1 month from the simulated end without early repayment (§5). Never used by the simulation |
| D6 | Actuals check-in | Complete rows only. Any month from the plan start to the current month. "Latest" = most recent month (§8) |
| D7 | Loan validation | `principal > 0`, `monthlyPayment > 0`, `0 ≤ apr ≤ 1`, amounts with 2 decimals, name optional (→ "Crédit n"), at most **6 active** loans |
| D8 | Loan identity | Loans have ids. Deleting a loan that has actuals **archives** it (history kept, excluded from the engine) |
| D9 | Budget lines | Free lists `(category: income \| fixed \| variable, label, amount, position)`, pre-filled with the spreadsheet's labels at 0 € on first login. The engine only uses the sums |
| D10 | UI warnings (engine unchanged) | Negative budget alert; "mensualité < intérêts" warning; "—" instead of "OK" for the debt ratio when income = 0; "Date limite dépassée" when the deadline is before the start |
| D11 | Plan highlighting | Strong highlight on the **first** month each milestone is reached (moving, emergency, debt-free, each loan paid off) plus a light tint afterwards; marker on the deadline month; red rows for negative months |
| D12 | Display | `fr-FR`, 2 decimals (`1 234,56 €`) everywhere; chart axes may show whole euros |

---

## 3. Inputs

### 3.1 Budget (`Budget!`)

| Field | Cell | Type | Notes |
|---|---|---|---|
| `budgetLines[category=income]` | B4:B6 | € / month | Spreadsheet labels: Salaire net, Primes / 13e mois (lissés), Autres revenus |
| `budgetLines[category=fixed]` | B10:B17 | € / month | Loyer, Charges/énergie, Assurances, Internet/mobile, Transport, Abonnements, Impôts mensualisés, Autres. **Excludes loan payments** |
| `budgetLines[category=variable]` | B21:B24 | € / month | Courses, Loisirs, Shopping, Divers (3-month average) |
| `startMonth` | B28 | `YYYY-MM` | First simulated month |
| `movingGoal` | B29 | € | Moving fund target |
| `movingDeadlineMonth` | B30 | `YYYY-MM` | Last month that can receive moving savings (inclusive) |
| `movingAlreadySaved` | B31 | € | Starting balance of the moving fund |
| `emergencyTarget` | B32 | € | Emergency fund target |
| `emergencyExisting` | B34 | € | Starting balance of the emergency fund |
| `riskFreeRate` | B35 | fraction (0.024 = 2.4 %) | Threshold ("taux seuil", e.g. Livret A) |
| `earlyRepaymentPct` | B36 | fraction 0..1 | Share of the remainder sent to early repayment |

Validation: amounts ≥ 0 with at most 2 decimals; `0 ≤ riskFreeRate ≤ 1`; `0 ≤ earlyRepaymentPct ≤ 1`.

Derived: `totalIncome`, `totalFixed`, `totalVariable` (sums, B7/B18/B25);
`expenses = totalFixed + totalVariable`; hint
`suggestedEmergencyTarget = 3 × (totalFixed + totalVariable + Σ monthlyPayment)` (B33), not used by the engine.

The regular budget is constant over the horizon (no inflation, no income changes); one-off exceptions
(D14) add extra income or expenses to a single month: `extraIncome(m)`, `extraExpenses(m)` = sums of that
month's exceptions.

### 3.2 Loans (`Crédits!A5:E10`)

| Field | Col | Notes |
|---|---|---|
| `name` | A | Optional → "Crédit n" (n = position) |
| `type` | B | Free text with suggestions: Prêt personnel, Prêt affecté, Revolving, Prêt étudiant, Prêt immobilier, Dette personnelle |
| `principal` | C | Remaining principal ("capital restant dû"), > 0 |
| `apr` | D | TAEG as a fraction, 0 ≤ apr ≤ 1 (0 allowed, e.g. personal debts) |
| `monthlyPayment` | E | > 0 |
| `contractEndMonth` | — | Optional YYYY-MM, last instalment per the contract (D5b); not in the spreadsheet |
| `position` | row order | Entry order, used to break APR ties |

Column F (Durée restante) is **not used** (D5).

---

## 4. Simulation engine (`Calcul!`), month m = 1..300

### 4.0 Money and rounding (D2)

- Every money amount is an integer number of cents.
- `round2(x)` means Excel `ROUND(x, 2)`: take the value to 15 significant digits (Excel's display
  precision, which absorbs binary noise such as `318.09499999999997`), then round **half away from
  zero**. The engine must use this exact function.
- Rounding happens at exactly these points. Everything else is a sum or difference of cents and
  is therefore exact:
  1. monthly interest (plan) — *deviation from the spreadsheet*
  2. monthly interest (baseline) — *deviation*
  3. `toEarlyRepayment = round2(remainder × earlyRepaymentPct)` — *deviation*
  4. KPI `movingMonthlyNeeded` — *deviation*
  5. balances after payment / after early repayment (already rounded in the spreadsheet; they are
     exact once the inputs are cents)
- Rates (`apr`, `riskFreeRate`, `earlyRepaymentPct`, ratios) are not money and are not rounded.
- Effect vs the unpatched spreadsheet: each rounding moves a value by at most half a cent, but the
  effect can accumulate in cumulative columns over 300 months, so the app will not match the
  original spreadsheet to the cent. The golden data contains the patched values.

### 4.1 Eligibility and priority (`Crédits!J:K`)

```
eligible_i  = apr_i > riskFreeRate                         (strict)
priority_i  = eligible_i ? 1 + #{eligible j : apr_j > apr_i} + #{eligible j before i : apr_j = apr_i} : none
```

APR descending, ties broken by entry order (avalanche). A 0 % loan is never eligible.

### 4.2 Plan scenario, per loan i

```
startBalance(1)      = principal_i
startBalance(m>1)    = endBalance(m−1)
interest             = round2(startBalance × apr_i / 12)
paymentPaid          = normalPayment(startBalance + interest, monthlyPayment_i)
                       where normalPayment(due, m) = due − m < 1 € ? due : m      (D13; spreadsheet: min(m, due))
balanceAfterPayment  = startBalance + interest − paymentPaid
extraRepayment       = min(Σ extra repayments on i in m, balanceAfterPayment)            (D17, simulator only; else 0)
open                 = balanceAfterPayment − extraRepayment
earlyRepayment       = priority_i none → 0
                       else max(0, min(open, toEarlyRepayment(m) − Σ_{j : priority_j < priority_i} open_j))
endBalance           = open − earlyRepayment
```

- The early-repayment formula is the **avalanche**: the month's early-repayment budget fills
  priority 1 up to its post-payment balance, then priority 2, and so on (overflow across several
  loans in the same month is covered by the golden data).
- Early repayment is applied **after** the normal payment of the same month.
- A paid-off loan has `paymentPaid = 0` from the next month on, so its payment is freed
  automatically and increases `available`.
- The last normal payment is capped at `balance + interest`, so it can be smaller than `monthlyPayment`.
- If `monthlyPayment < interest`, the balance grows every month (negative amortisation). The
  engine does not cap it; the UI warns (D10).

### 4.5 Principal at the plan start (D5c)

```
payments        = monthsBetween(principalPaidThroughMonth, startMonth) − 1
principalAtStart = payments > 0 ? roll principal forward `payments` months with §4.2 rules
                   (interest = round2(balance × apr / 12), payment = min(monthlyPayment, balance + interest))
                 : principal
```

Example: capital read after the September 2026 payment, plan starting November 2026 → only October's
payment is deducted (November's is plan month 1). The engine receives `principalAtStart` as `principal`.

### 4.3 Baseline scenario (no early repayment), per loan i

```
baselineStart(1) = principal_i;  baselineStart(m>1) = baselineEnd(m−1)
baselineInterest = round2(baselineStart × apr_i / 12)
baselineEnd      = baselineStart + baselineInterest − normalPayment(baselineStart + baselineInterest, monthlyPayment_i)
```

### 4.4 Monthly totals (`Calcul!AX:BB`)

`totalPayments = Σ paymentPaid`, `totalEarlyRepayment = Σ earlyRepayment`, `totalEndDebt = Σ endBalance`,
`totalInterest = Σ interest`, `totalBaselineInterest = Σ baselineInterest`.

---

## 5. Loans page: derived values (`/credits`)

| Output | Rule |
|---|---|
| `earlyRepaymentWorthIt` (J) | "Oui" if eligible, else "Non" |
| `priority` (K) | §4.1 (empty if not eligible) |
| `advice` (L) | apr ≥ 0.10 → "Taux élevé : à solder en priorité"; eligible → "Remb. anticipé intéressant (vérifier IRA)"; else "Garder, épargner plutôt" |
| `payoffMonthWithPlan` | *new (D5)*: month of the first `endBalance ≤ 0.01`; none within 300 months → "Au-delà de 25 ans" |
| `payoffMonthWithoutPlan` | *new*: same on `baselineEnd` |
| `interestWithPlan` / `interestWithoutPlan` | *new*: Σ over 300 months of `interest` / `baselineInterest` for this loan |
| Totals | `totalPrincipal = Σ principal`; `weightedApr = Σ(principal × apr) / Σ principal` (0 if no loans); `monthlyPayments = Σ monthlyPayment` |

Contract end check (D5b): when `contractEndMonth` is set and a plan exists, compare it with
`payoffMonthWithoutPlan` (the contract assumes normal payments). Consistent if the gap is ≤ 1 month; otherwise
warn "Fin du contrat : X, mais avec cette mensualité le crédit se termine en Y (±n mois). Vérifiez le capital restant
dû, le TAEG ou la mensualité." A loan that never ends within 300 months is always inconsistent.

Badge "Remb. anticipé rentable" = `earlyRepaymentWorthIt`. Warning (D10) when
`monthlyPayment ≤ round2(principal × apr / 12)`.

---

## 6. Monthly allocation (`Plan!`), month m = 1..300

```
yearMonth(m)          = startMonth + (m − 1) months
income(m)             = Σ income lines active in m + extraIncome(m)             (D15, D14)
expenses(m)           = Σ fixed + variable lines active in m + extraExpenses(m) (D15, D14)
                        (a line is active in m if startMonth ≤ m ≤ endMonth, open bounds allowed)
available      (F)    = income(m) − expenses(m) − totalPayments(m)             (can be negative)

① Moving fund
toMoving       (G)    = yearMonth(m) ≤ movingDeadlineMonth ? max(0, min(available, movingGoal − movingCum(m−1))) : 0
movingCum      (H)    = movingCum(m−1) + toMoving                  movingCum(0) = movingAlreadySaved

② Emergency fund
toEmergency    (I)    = max(0, min(available − toMoving, emergencyTarget − emergencyCum(m−1)))
emergencyCum   (J)    = emergencyCum(m−1) + toEmergency            emergencyCum(0) = emergencyExisting

③ Remainder
remainder      (K)    = max(0, available − toMoving − toEmergency)
toEarlyRepayment (L)  = round2(remainder × earlyRepaymentPct)
unusedEarlyRepayment (M) = max(0, toEarlyRepayment − totalEarlyRepayment(m))
toFreeSavings  (N)    = remainder − toEarlyRepayment + unusedEarlyRepayment
freeSavingsCum (O)    = freeSavingsCum(m−1) + toFreeSavings − extraFromFreeSavings(m)
                        freeSavingsCum(0) = freeSavingsExisting (D16, default 0); extraFromFreeSavings: D17, else 0

Debts / flags
remainingDebt  (P)    = totalEndDebt(m)
negativeBudget (Q)    = available < 0
movingReached  (R)    = movingCum ≥ movingGoal
emergencyReached (S)  = emergencyCum ≥ emergencyTarget
debtFree       (T)    = remainingDebt ≤ 0.01
```

Behaviours kept from the spreadsheet (confirmed by the Excel scenarios):
- There is no circularity: `paymentPaid` depends only on the previous balance.
- **A negative month is dropped**: all allocations are 0 and nothing is withdrawn from savings, so
  cumulative balances never decrease. The UI shows an alert (D10).
- The moving fund keeps its balance after the deadline; that money is never released to other buckets.
- Flags stay at 1 once reached (the balances never decrease).
- If `movingDeadlineMonth < startMonth`, the moving fund never receives anything.

---

## 7. KPIs (`Synthèse!`, dashboard `/`)

| KPI | Cell | Rule |
|---|---|---|
| `monthlyIncome` | B4 | totalIncome |
| `monthlyExpenses` | B5 | expenses |
| `monthlyLoanPayments` | B6 | Σ monthlyPayment of active loans (nominal) |
| `margin` | B7 | B4 − B5 − B6 |
| `debtRatio` | B8 | B6 / B4; 0 if income = 0 (UI shows "—", D10) |
| `debtAlert` | B9 | > 0.35 → "Au-dessus de 35 %"; > 0.30 → "Proche du seuil"; else "OK" |
| `totalPrincipal` / `weightedApr` | B10/B11 | §5 |
| `movingGoal` | B14 | input |
| `movingMonthlyNeeded` | B15 | `round2(max(0, goal − alreadySaved) / max(1, monthsBetween(startMonth, deadlineMonth) + 1))`; **0 if deadline < start** (UI: "Date limite dépassée") |
| `movingAmountAtDeadline` | B16 | movingCum of the plan month = deadline month (or the last plan month before it); deadline before start → movingAlreadySaved |
| `movingReachedDate` | B17 | first month with movingReached, else "Non atteint" |
| `movingStatus` | B18 | B16 ≥ goal → "Objectif tenu", else "Objectif NON tenu : réduire dépenses ou décaler la date" |
| `emergencyTarget` | B21 | input |
| `emergencyReachedDate` | B22 | first month with emergencyReached, else "Non atteint (25 ans)" |
| `debtFreeDate` | B25 | no loans → "Aucune dette"; first month with debtFree; else "Au-delà de 25 ans" |
| `interestWithoutPlan` / `interestWithPlan` / `interestSaved` | B26–B28 | Σ totalBaselineInterest, Σ totalInterest, difference (before IRA penalties) |
| `freeSavingsAt12` / `emergencyFundAt12` / `remainingDebtAt12` | B31–B33 | plan month 12: O / J / P |
| `negativeBudgetMonths` | B34 | count of negativeBudget months (should be 0) |
| Latest actuals | B37–B40 | §8.3 |

Charts:
1. **24 months**: `remainingDebt` (red, should go down to 0) and `freeSavingsCum` (purple, should go up).
2. **12 months**: `movingCum` and `emergencyCum` (solid lines) against `movingGoal` and
   `emergencyTarget` (dashed lines).

---

## 8. Actuals tracking (`/suivi`, `Suivi réel!`)

### 8.1 Entry rules (D6)

- One entry per month, from `startMonth` to the current month (future months rejected). The current
  month is preselected. Re-submitting a month updates it.
- **Required**: `movingSavings`, `emergencySavings`, `freeSavings`, and the remaining principal of
  **every active loan** (0 allowed, e.g. a loan paid off). Amounts ≥ 0 with 2 decimals.
- **Optional, information only**: actual `income` and `expenses`. They are shown with their gap
  vs the budget but are **not** part of the status (the spreadsheet never used them either).
- Reason: in the spreadsheet a partially filled row counted blank balances as 0, so the status
  looked good while the data was simply missing.

### 8.2 Per month m

```
actualDebt      = Σ loan balances entered for that month (archived loans included if entered)
plannedDebt     = Plan.remainingDebt(m)
debtGap         = actualDebt − plannedDebt           good if ≤ 10 €
actualSavings   = movingSavings + emergencySavings + freeSavings
plannedSavings  = Plan.movingCum(m) + Plan.emergencyCum(m) + Plan.freeSavingsCum(m)
savingsGap      = actualSavings − plannedSavings     good if ≥ −10 €
movingGoalPct   = min(1, movingSavings / movingGoal)          (0 if goal = 0)   → progress bar
debtRepaidPct   = max(0, 1 − actualDebt / totalPrincipal)     (0 if no debt)   → progress bar
status          = both good → "Dans les temps" (green) · both bad → "En retard" (red) · else "Mitigé" (orange)
```

Boundaries are inclusive: a gap of exactly +10 € (debt) or −10 € (savings) is still good (tested).
The spreadsheet prefixes the status with ✅ / 🔴 / 🟠; the app uses coloured badges with the same
labels.

Note (same as the spreadsheet): the plan is always recomputed from the **current** inputs.
Updating a loan's principal changes the planned values of past months too. The owner should keep
the principal as of `startMonth`, and move `startMonth` forward when re-basing the plan.

### 8.3 Latest actuals (dashboard)

Latest = the most recent month with an entry. No entry → "Aucune saisie", gaps 0, status "—".

---

## 9. Golden data: `tests/fixtures/golden.json`

```
{ version, source, horizonMonths: 300, tolerance: 0.01, calculLoanColumns: [8 names], notes,
  scenarios: [ { id, description,
                 inputs:   { budget, loans[6] (null = empty slot), actuals[] },
                 expected: { credits[6], creditsTotals, plan[300], calcul[300], synthese, suivi[] } } ] }
```

- `calcul[m].loans[slot−1]` = `[startBalance, interest, paymentPaid, balanceAfterPayment,
  earlyRepayment, endBalance, baselineEndBalance, baselineInterest]`.
- Months are `YYYY-MM`. Text values keep the spreadsheet's exact French strings (the Suivi status
  keeps its emoji prefix; the app maps it to a badge). Numbers are rounded to 9 decimals. The test
  tolerance is ≤ 0.01 € per value.
- Budget labels in the fixtures are the spreadsheet's fixed rows (3 income, 8 fixed, 4 variable).

| Scenario | What it exercises |
|---|---|
| `base` | Template as-is: 4 bank loans (one below the threshold) + 2 personal debts at 0 %. Avalanche overflow in months 14 and 18, unused early repayment from month 24 |
| `no_loans` | "Aucune dette", debt ratio 0, the whole remainder goes to free savings |
| `negative_budget` | 4 negative months, then positive once the personal debts are repaid |
| `always_negative` | 300 negative months, every target "Non atteint" |
| `deadline_passed` | Deadline before start: monthly needed 0, amount at deadline = already saved |
| `payment_below_interest` | Revolving payment 20 € < 29.14 € interest: baseline never repaid, "interest saved" is huge (68,212.87 €) |
| `all_ineligible` | Threshold 25 %: no priorities, interest saved 0 |
| `pct_0` / `pct_100` | earlyRepaymentPct bounds |
| `goals_already_met` | Both funds reached in month 1 |
| `apr_ties` | Equal APR → entry order decides |
| `zero_income` | Debt ratio fallback, 300 negative months |
| `big_windfall` | Large income: both goals in month 1, overflow across loans in month 2; the ineligible 1.2 % loan still runs to its normal end (debt-free 2028-11) |
| `rounding_ties` | Exact half-cent ties (interest 0.375 → 0.38; odd-cent remainder × 50 %, e.g. 318.095 → 318.10) |
| `suivi_actuals` | 5 complete actuals rows: on track / late / mixed / exactly at ±10 € / ahead of plan |
| `small_residual` | 795 € at 1,5 %, 80 €/month: the 10th payment becomes 80,48 € instead of leaving 0,48 € for an 11th month (D13) |

Regenerate (Windows + desktop Excel): see `scripts/README.md`. The export aborts if the
independent reference engine disagrees with Excel on any cell.

---

## 10. Exports (D18)

### 10.1 JSON backup, `finance-backup-YYYY-MM-DD.json`

```
{ format: "finance-plan-backup", version: 1, exportedAt: ISO timestamp,
  data: { settings | null,
          budgetLines[] { id, category, label, amount, position, startMonth, endMonth },
          exceptions[]  { id, month, kind, label, amount },
          loans[]       { id, name, type, principal, principalPaidThroughMonth, apr, monthlyPayment,
                          contractEndMonth, position, archivedAt }   active first, then archived,
          checkIns[]    { id, month, income, expenses, movingSavings, emergencySavings, freeSavings,
                          loanBalances[] { loanId, balance }, frozen | null } } }
```

- Amounts are **strings** in euros with exactly 2 decimals and a dot (`"1234.50"`, `"-0.05"`),
  converted from integer cents, so no precision is lost. Rates (`apr`, `riskFreeRate`,
  `earlyRepaymentPct`) are fractions as stored. Months are `YYYY-MM`; `null` = empty.
- Empty collections are empty arrays; `settings` is `null` before onboarding.
- `version` changes whenever the shape changes; an import (#8) must check `format` and `version`.

### 10.2 Plan CSV, `finance-plan-YYYY-MM-DD.csv`

- UTF-8 with BOM, CRLF line ends, one header row and one row per plan month (300).
- Columns: `Mois` (`YYYY-MM`), `N°`, then the monthly amounts (income, of which exceptions,
  expenses, of which exceptions, loan payments, available, moving paid / cumulative, emergency
  paid / cumulative, remainder, early repayment, unused early repayment, free savings paid /
  cumulative, interest, remaining debt), one `Restant dû <crédit>` column per active loan, and
  `Budget négatif` (`oui` / `non`).
- Amounts have exactly 2 decimals, no thousands separator. French format: `;` and decimal comma;
  international: `,` and decimal dot.
- Text cells are quoted when they contain the separator, a quote or a line break; a text cell
  starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` (formula injection).

---

## 11. Template import (D20)

- Sheets `Budget` and `Crédits`; other sheets are ignored. Rows are located by their column-A labels
  (accents, case and spacing ignored), so inserted rows are tolerated; a missing section or label
  → « Ce fichier n’est pas le modèle attendu ».
- Budget lines: every non-empty row between a section header (`REVENUS…`, `CHARGES FIXES…`,
  `DÉPENSES VARIABLES…`) and its `Total…` row; label = column A, amount = column B (blank = 0).
- Parameters: column B of the rows labelled as in §3.1. Dates may be Excel dates or text
  (`2027-01`, `15/01/2027`, `01/2027`) → `YYYY-MM`. Rates are fractions (`0,049`) or text with `%`.
  `freeSavingsExisting` is not in the template: the current value is kept (0 for a new user).
- Loans: rows under the `Capital restant dû` header until `TOTAL`, blank rows skipped, at most 6.
  The principal is read as the balance at the plan start (`principalPaidThroughMonth` empty, D5c);
  an existing loan's `contractEndMonth` is kept.
- Amounts: numbers or French text (`1 100,50`); floating-point noise is removed before checking the
  2-decimal rule.
- Writes (not atomic): budget, then loan removals, updates, creations. A failure shows an error;
  re-importing the same file converges to the same data.
