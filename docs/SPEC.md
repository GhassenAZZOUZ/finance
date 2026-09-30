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
| D33 | Savings deposits, computed balances (issue #73, owner-validated 2026-09-30) | The check-in's « Épargne versée ce mois » asks, for each savings goal (priority order), the emergency fund and free savings, **what was put in this month** (a withdrawal is negative: « −200 » = « Retrait de 200,00 € »), next to the **plan's deposit** = the change of that pot's planned balance that month (so a December includes the credited interest, D28, and free savings the extra repayments taken from them, D17); « Comme prévu » / « Tout comme prévu » copy it. **Balances are computed, never typed**: balance(pot, m) = its starting amount at the plan start (goal `alreadySaved`, `emergencyExisting`, `freeSavingsExisting`) + the deposits from the plan start to m, where **a month without a check-in counts the plan's deposit** (Suivi says « Février 2027 non saisi : versements prévus retenus »); entering it later replaces it and every later balance follows. The computed balances feed §8.2, the dashboard, the goals' progress and « Recaler le plan » (D16: after a re-base, counting restarts from the new start and its starting amounts). A deposit that would take a pot below 0 is refused (« Le solde deviendrait négatif »). Deposits are saved with the check-in (`save_actual`, table `monthly_actual_deposits`, with the plan's deposit and the goal's name at save time; a deleted goal's deposits keep its name and no longer count). Check-ins saved before (typed balances, no deposits) keep their balances as they are, so their results are unchanged to the cent, and the next months add to them; their form shows the balance change as the deposit. Loan balances are still read from the statements. New check-ins no longer store balances (`emergency_savings`, `free_savings` null, no goal balances); a later migration drops those columns once no typed check-in is left. Goals start from their amount already saved at the plan start (the engine's rule), not from their creation month |
| D32 | Actual amount per budget line (issue #72, owner-validated 2026-09-30) | Budget builds the plan; Suivi checks it was followed. The check-in's « Revenus et dépenses du mois » section has **one required row per budget line active that month** (D15), grouped like Budget, plus the month's one-off exceptions (D14) and two rows « Autres revenus / Autres dépenses (hors budget) » (budget 0). Each row shows the month's budget (D27 indexation; exceptions not indexed), an actual amount ≥ 0 and the gap (income under budget or expense over it by more than 10 € flagged in words and with an icon). « Comme prévu » copies a row's budget, « Tout comme prévu » a group's into its empty rows. The month's `income` / `expenses` become the sums of the rows (§8.2 gaps). Rows are saved **with the check-in, in one transaction** (`save_actual`, table `monthly_actual_lines`), each with a **copy of its label, category and budget**: renaming, re-pricing or deleting a line or an exception later never rewrites a past month (its link becomes null, the copy stays). Check-ins saved before have no rows (« non détaillé »). The bank CSV (D30/D31) pre-fills the budget-line rows (0 for a line without operations); only its rules are stored. Backup format 11 |
| D31 | Bank import rules and « Réel vs budget » (issue #63, split from #38) | When an import is confirmed, each assigned transaction teaches a **keyword rule**: the label's first two words, normalised (upper case, no accents, digits or punctuation) → its budget line or « Ignoré »; one rule per keyword, the latest assignment wins (table `bank_csv_rules`, a rule goes with its deleted line). The next imports **pre-assign** matching transactions (keyword found in the normalised label as whole words, longest keyword first), marked « proposé » until changed; rules are listed and deleted from the import section. An import computes the month's **actual total per budget line** (income received, money spent, refunds lowering it), which pre-fills the check-in's rows (D32; before #72 they were stored apart in `bank_line_totals`, now dropped); the rules are saved with `save_bank_rules`. Suivi's « Réel vs budget par ligne » card shows the rows of the check-ins entered line by line (D32): budget of that month, actual and gap, an expense line over budget (« dépassement ») or an income line under it (« en dessous ») flagged in words and with an icon. Still no transaction stored. Backup format 10 |
| D30 | Bank CSV import (issue #38, owner-validated 2026-09-29, part (a)) | In the check-in's « Revenus et dépenses du mois » section: « Importer le relevé CSV de <mois> ». The file (≤ 5 MB, .csv / text, UTF-8 or Windows-1252, `;` `,` or tab, quoted cells) is **read in the browser**. A **Revolut** export is recognised from its header and needs no mapping: amount = `Amount − Fee`, date = `Completed Date`, only `COMPLETED` rows in EUR (the others are listed as ignored with the reason). Other banks: a column mapping (date, label, signed amount or debit / credit, decimal separator, date format), guessed from the header, checked once and **saved per user** (`profiles.bank_csv_mapping`) for files with the same header. Only the chosen month's transactions are kept (the others are counted). Each one is assigned **by hand** to a budget line or « Ignoré » (pre-set: money in → first income line, money out → first variable line); totals: income = Σ on income lines, expenses = − Σ on fixed / variable lines (refunds lower them). « Reporter dans le suivi » pre-fills the check-in's rows per budget line (still editable, D32; before #72: the income and expenses totals). **No transaction is stored** (labels are shown as text only); only the mapping is saved and exported. Keyword rules and the per-line table: #63 |
| D29 | Income paydays (issue #60, owner-validated 2026-09-29) | Each **income line** has a usual payday (Budget page, in the line's panel): a day 1–31 and « du mois précédent » or « du mois même » (a day the month lacks = its last day); default 1 of the same month = today's behaviour. The income of month M is the one that funds M's budget, even when paid in M−1. On Suivi, the « Revenus de <mois> » card (next month first, then the open months) shows each income line of that month (amount > 0, active, D15) with its expected date and a « Versé à une autre date » field: a **per-month exception** (table `income_payments`, one date per month and income line), from the 1st of M−1 to the last day of M and **not after today** (Europe/Paris). Effective payment date = the exception, else the usual payday. Deleting an income line deletes its dates; the template import keeps the payday of reused slots. **Early check-in (issue #61)**: the next month opens as soon as its **first** income is paid (earliest effective date ≤ today; never further than the next month); the card says when it opens. An early month's **loan balances are not entered**: the plan's balances after that month's payment are shown read-only and saved (the payment is considered made by the end of the month); the server recomputes the window and those balances from the saved data. A later change that closes the month again keeps a check-in already saved. The reminder e-mail (D25) is unchanged |
| D28 | Savings interest (issue #35, owner-validated 2026-09-29) | An optional **yearly rate per savings bucket**: each goal (D23), the emergency fund and free savings (fractions 0–1, 0 by default = no interest, golden data unchanged; no global default rate; gross rates, taxes out of scope). Interest **accrues monthly**, `round2(balance × rate / 12)` on the bucket's balance at the start of the month (§4.0 point 8), in negative months too, and is **credited once a year after December's allocation** (and in month 300), so it counts toward targets and earns interest from January; the first year is credited pro rata of the months accrued. Quinzaines (Livret A) are not modelled. A goal keeps its interest even above its target. The emergency fund's interest fills it **up to its target; the rest goes to free savings**. Planned savings of check-ins include the credited interest (frozen check-ins keep their values). KPIs « Intérêts de l'épargne » over the first 12 months and over the plan; « Intérêts épargne » column in the Plan table and the CSV. The template import (D20) keeps the rates. Engine: §6 ④ |
| D27 | Yearly indexation (issue #36, owner-validated 2026-09-29) | Two optional plan parameters, `expenseInflationRate` and `incomeGrowthRate` (fractions from −1 to 1, 0 by default = constant budget, golden data unchanged); **one** expense rate for fixed and variable lines. The step happens **every January**: in month m a line counts `round2(amount × (1 + rate)^y)` with `y = year(m) − year(startMonth)` (so the first rise is the first January after the start), always computed from the entered amount (§4.0 point 7). Income lines use the income rate, fixed and variable lines the expense rate; a line marked **« non indexé »** keeps its amount. **Not indexed**: loan payments, one-off exceptions (D14), goal targets. Dated lines (D15) are indexed **from the plan start** (amounts are entered in euros of the start year). The KPIs describe the reference month (D15) at its indexed amounts, and check-in income / expense gaps compare with that month's indexed budget. Re-basing (D16) moves the start, so the index restarts from the new start year. The template import (D20) sets both rates to 0; « Et si… ? » can change them (D17) |
| D26 | Account deletion (issue #37, owner-validated 2026-09-29) | « Mes données » › « Supprimer mon compte »: the user types **« SUPPRIMER »** (no recent sign-in required) after being offered the JSON backup (D18); the page says it is irreversible and that the host's technical backups are erased at the end of their retention period. The `security definer` function `delete_my_account()` (authenticated only) deletes the caller's check-in loan balances (whose loan foreign key restricts, D8) then their `auth.users` row; every other table cascades from it, including the reminder log, so no reminder is sent afterwards. Then the local session is dropped, the tour flag cleared (the theme choice is kept) and the login page confirms. Signing in again with the same address starts from scratch. An integration test lists every public table, so a new table must be checked for its cascade |
| D25 | Monthly reminder (issue #6) | An e-mail on the **last day of the month** (Europe/Paris; the scheduled GitHub Action calls the Edge Function `monthly-reminder` daily at 16:00 UTC ≈ 18:00 Paris in summer, 17:00 in winter) to every user who has the reminder **on (default)**, has a plan started by that month, and has **no check-in for that month yet**. Content: the month and a link to Suivi, **no amount**; an unsubscribe link (`/rappel/?jeton=…`, no login) turns it off for that token's owner only; « Mes données » turns it on or off. **At most one e-mail per user and month**: a `reminder_log` row is claimed before sending and released if the send fails, so a retry resends only the failures; a failure makes the run red (GitHub e-mails the owner). SMTP credentials are Supabase secrets; the service key never leaves Supabase |
| D24 | Bank overdraft (issue #28, owner-validated 2026-09-28) | A debt of kind `overdraft` next to the loans, counted in the 6-debt limit (D7): name, **authorised limit** > 0, **balance used** 0 ≤ balance ≤ limit (form rule), **agios rate** 0–100 %, optional **fixed monthly repayment** (default 0). No mensualité, IRA, contract end or read month. Each month: agios = round2(balance × rate / 12) **added to the balance**; the fixed repayment (capped at balance + agios, no D13 residual rule) is part of the loan payments; eligible for early repayment when its rate > threshold, **even at 0 €**. A **negative month draws on the overdrafts** (entry order) up to their limit; the rest of the shortfall is dropped as before (§6) and the alert still shows. A cleared overdraft stays available: never archived (also on re-basing, D16), never a payoff milestone, and 0 € counts as debt-free. Fees and unauthorised overdraft are out of scope. The migration converted loans whose type contains « découvert » (limit = balance, fixed repayment = old payment). No spreadsheet equivalent: cross-checked with `scripts/reference_overdraft.py`. Loans are unchanged (golden data green) |
| D23 | Several savings goals (issue #10, owner-validated 2026-09-28) | Up to **6 goals**, each with a name, target > 0, deadline month, amount already saved and a unique priority (1 = filled first). The spreadsheet's moving fund is the **primary goal**: the first goal added, stored and edited like the others (goals card; tech-debt 6, 2026-09-30), its target may be 0; it is deleted only by choosing the goal that becomes primary (the last goal can be deleted: no goal = an empty fund). The engine still receives it as its moving fund (id `moving`), so existing users keep exactly the same results. Each month, goals are filled **in priority order, before the emergency fund**, each up to its target and only **until its deadline** (then it receives nothing more, keeps its balance and is flagged « hors délai » with the amount missing). The moving* KPIs describe the primary goal; each goal has the same KPIs. Check-ins ask **one balance per goal**, the primary one included; comparisons use the sum of all goals. A new deadline must not be in the past (a goal keeps the past deadline it already has). Engine: §6 ① |
| D22 | Early-repayment penalties (issue #9, owner-validated 2026-09-28) | Optional per loan: `penaltyPct` (% of the capital repaid early) and `penaltyCapMonths` (cap: N months of interest on that capital; French home loans: 3 % / 6 months; consumer loans: a flat 1 % or 0,5 %, the 10 000 €/12 months exemption is not modelled: leave it empty). The penalty is paid from the month's early-repayment budget; a loan is skipped when the penalty is not below the interest the repaid money would still cost (apr / 12 × remaining months), and its share goes to the next priority, then to free savings. « Intérêts économisés » is net of penalties. Empty = no penalty = previous behaviour (golden data unchanged). Engine: §4.2 "Penalties" |
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
| D6 | Actuals check-in | Complete rows only. Any month from the plan start to the current month, **or to the next month once its first income is paid** (D29, issue #61). "Latest" = most recent month (§8) |
| D7 | Loan validation | (overdraft: D24) `principal > 0`, `monthlyPayment > 0`, `0 ≤ apr ≤ 1`, amounts with 2 decimals, name optional (→ "Crédit n"), at most **6 active** loans |
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

The regular budget is constant over the horizon unless a yearly indexation rate is set (D27: every
January, each line `round2(amount × (1 + rate)^y)`); one-off exceptions
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
  6. early-repayment penalty `penalty = round2(repaid × penaltyRate)` (D22; 0 without a penalty)
  7. indexed budget line `round2(amount × (1 + rate)^y)` (D27; the entered amount when the rate is 0)
  8. monthly savings interest `round2(balance × rate / 12)` per bucket (D28; 0 without a rate)
  5. balances after payment / after early repayment (already rounded in the spreadsheet; they are
     exact once the inputs are cents)
- Rates (`apr`, `riskFreeRate`, `earlyRepaymentPct`, `expenseInflationRate`, `incomeGrowthRate`,
  ratios) are not money and are not rounded.
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
                       (no penalty on any loan; with penalties see "Penalties (D22)" below)
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

**Overdraft (D24).** For a debt with `kind = overdraft`, `limit` = authorised amount:

```
interest             = round2(startBalance × apr / 12)                  (agios, added to the balance)
paymentPaid          = min(fixedRepayment, startBalance + interest)     (no D13 residual rule)
eligible             = apr > riskFreeRate                               (even when the balance is 0)
shortfall            = max(0, −available(m))                            (§6)
draw                 = overdrafts in entry order: min(shortfall left, limit − (open − earlyRepayment))
endBalance           = open − earlyRepayment + draw
baseline             = no early repayment, no draws; the account pays the agios each month:
                       baselinePayment = min(max(fixedRepayment, interest), balance + interest)
                       (staying overdrawn costs the agios, it does not snowball for 25 years)
```

The balance never exceeds the limit through a draw; agios alone can take it above (as a bank
would charge them). Expected values: `tests/fixtures/overdraft-reference.json`, produced by the
independent `scripts/reference_overdraft.py` from `scripts/overdraft_scenarios.json`.

**Penalties (D22).** A loan may have `penaltyPct` (fraction of the capital repaid early) and
`penaltyCapMonths` (optional cap: that many months of interest on the capital repaid early).

```
penaltyRate_i  = penaltyPct_i = 0 → 0
                 else min(penaltyPct_i, penaltyCapMonths_i × apr_i / 12)      (no cap → penaltyPct_i)
penalty(P)     = round2(P × penaltyRate_i)
n_i(m)         = months of normal payments left on open_i (§4.2 rules, no early repayment; ∞ if never repaid)
worth_i(m)     = penaltyRate_i = 0 or penaltyRate_i < apr_i / 12 × n_i(m)     (strict: net gain > 0)

budgetLeft     = toEarlyRepayment(m)
for i in priority order:
  skip if open_i = 0 or not worth_i(m)
  earlyRepayment_i = the largest P ≤ min(open_i, budgetLeft) with P + penalty(P) ≤ budgetLeft
  penalty_i        = penalty(earlyRepayment_i)
  budgetLeft      −= earlyRepayment_i + penalty_i
```

- The penalty is paid from the same month's early-repayment budget. `apr / 12 × n` is a lower
  bound of the interest a euro repaid now saves (it ignores compounding), so a skipped loan is
  never one where repaying would have gained money. A skipped loan's share goes to the next
  priority; what no loan takes is `unusedEarlyRepayment` (→ free savings, §6).
- With no penalty on any loan this is exactly the formula above (golden data unchanged).

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
| `advice` (L) | apr ≥ 0.10 → "Taux élevé : à solder en priorité"; eligible → "Remb. anticipé intéressant" (the app computes the IRA entered on the loan, D22); else "Garder, épargner plutôt" |
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

① Savings goals (D23), g = 1..n in priority order (spreadsheet: the moving fund alone, n = 1)
left(1)        = available
toGoal_g       = yearMonth(m) ≤ deadline_g ? max(0, min(left(g), target_g − goalCum_g(m−1))) : 0
left(g+1)      = left(g) − toGoal_g
goalCum_g      = goalCum_g(m−1) + toGoal_g                goalCum_g(0) = alreadySaved_g
toMoving   (G) = Σ_g toGoal_g
movingCum  (H) = Σ_g goalCum_g

② Emergency fund
toEmergency    (I)    = max(0, min(available − toMoving, emergencyTarget − emergencyCum(m−1)))
emergencyCum   (J)    = emergencyCum(m−1) + toEmergency            emergencyCum(0) = emergencyExisting

③ Remainder
remainder      (K)    = max(0, available − toMoving − toEmergency)
toEarlyRepayment (L)  = round2(remainder × earlyRepaymentPct)
unusedEarlyRepayment (M) = max(0, toEarlyRepayment − totalEarlyRepayment(m) − totalPenalty(m))   (penalties: D22)
toFreeSavings  (N)    = remainder − toEarlyRepayment + unusedEarlyRepayment
freeSavingsCum (O)    = freeSavingsCum(m−1) + toFreeSavings − extraFromFreeSavings(m) + freeSavingsInterest(m)
                        freeSavingsCum(0) = freeSavingsExisting (D16, default 0); extraFromFreeSavings: D17, else 0

④ Savings interest (D28), 0 without rates
accrued_b      += round2(cum_b(m−1) × rate_b / 12)      each month, per bucket b (goals, emergency, free)
crediting(m)    = yearMonth(m) is a December, or m = 300; then accrued_b is credited and reset to 0:
goalInterest_g  = accrued_g                                  (added to goalCum_g, even above target)
emergencyInterest = min(accrued_emergency, max(0, emergencyTarget − emergencyCum(m−1) − toEmergency))
freeSavingsInterest = accrued_free + accrued_emergency − emergencyInterest
(goalCum_g and emergencyCum above also add their interest of the month)

Debts / flags
remainingDebt  (P)    = totalEndDebt(m)
negativeBudget (Q)    = available < 0
movingReached  (R)    = every goal g: goalCum_g ≥ target_g
emergencyReached (S)  = emergencyCum ≥ emergencyTarget
debtFree       (T)    = remainingDebt ≤ 0.01
```

Behaviours kept from the spreadsheet (confirmed by the Excel scenarios):
- There is no circularity: `paymentPaid` depends only on the previous balance.
- **A negative month is dropped** (with an overdraft, it is first drawn on it up to its limit, D24): all allocations are 0 and nothing is withdrawn from savings, so
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
| `movingMonthlyNeeded` (primary goal; same rule per goal in `goals[]`, D23) | B15 | `round2(max(0, goal − alreadySaved) / max(1, monthsBetween(startMonth, deadlineMonth) + 1))`; **0 if deadline < start** (UI: "Date limite dépassée") |
| `movingAmountAtDeadline` | B16 | movingCum of the plan month = deadline month (or the last plan month before it); deadline before start → movingAlreadySaved |
| `movingReachedDate` | B17 | first month with movingReached, else "Non atteint" |
| `movingStatus` | B18 | B16 ≥ goal → "Objectif tenu", else "Objectif NON tenu : réduire dépenses ou décaler la date" |
| `emergencyTarget` | B21 | input |
| `emergencyReachedDate` | B22 | first month with emergencyReached, else "Non atteint (25 ans)" |
| `debtFreeDate` | B25 | no loans → "Aucune dette"; first month with debtFree; else "Au-delà de 25 ans" |
| `interestWithoutPlan` / `interestWithPlan` / `interestSaved` | B26–B28 | Σ totalBaselineInterest, Σ totalInterest, difference **minus Σ penalties paid** (`penaltiesPaid`, D22; the spreadsheet had no penalties) |
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

- One entry per month, from `startMonth` to the current month (future months rejected), or to the
  next month once its first income is paid (D29: its loan balances then come from the plan). The
  oldest month still to enter is preselected. Re-submitting a month updates it.
- **Required**: the actual amount of **every row of the month** (D32: budget lines active that
  month, its exceptions, « hors budget »), **this month's deposit** into every savings goal, the
  emergency fund and free savings (D33: negative for a withdrawal; the balances are computed), and
  the remaining principal of **every active loan** (0 allowed, e.g. a loan paid off). Amounts with
  2 decimals, ≥ 0 except deposits.
- `income` and `expenses` are the sums of the rows (D32). They are shown with their gap vs the
  budget but are **not** part of the status (the spreadsheet never used them either).
- Reason: in the spreadsheet a partially filled row counted blank balances as 0, so the status
  looked good while the data was simply missing.

### 8.2 Per month m

```
actualDebt      = Σ loan balances entered for that month (archived loans included if entered)
plannedDebt     = Plan.remainingDebt(m)
debtGap         = actualDebt − plannedDebt           good if ≤ 10 €
actualSavings   = Σ goal balances + emergencySavings + freeSavings   (D23: one per goal; D33: balances computed from the deposits)
plannedSavings  = Plan.movingCum(m) + Plan.emergencyCum(m) + Plan.freeSavingsCum(m)
savingsGap      = actualSavings − plannedSavings     good if ≥ −10 €
movingGoalPct   = min(1, (movingSavings + Σ goal balances) / Σ goal targets)   (0 if 0)   → progress bar
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
{ format: "finance-plan-backup", version: 12, exportedAt: ISO timestamp,
  data: { settings | null   { startMonth, emergencyTarget, emergencyExisting, freeSavingsExisting,
                              riskFreeRate, earlyRepaymentPct, expenseInflationRate, incomeGrowthRate,
                              emergencyRate, freeSavingsRate },
          budgetLines[] { id, category, label, amount, position, startMonth, endMonth, indexed,
                          paydayDay, paydayPreviousMonth },
          incomePayments[] { month, budgetLineId, paidOn }   (D29),
          bankCsvMapping | null   (D30),
          bankRules[] { keyword, budgetLineId }, bankLineTotals[] { month, budgetLineId, actual }   (D31),
          exceptions[]  { id, month, kind, label, amount },
          loans[]       { id, name, type, principal, principalPaidThroughMonth, apr, monthlyPayment,
                          contractEndMonth, penaltyPct, penaltyCapMonths, kind, creditLimit, position, archivedAt }
                          active first, then archived,
          goals[]       { id, name, target, deadlineMonth, alreadySaved, priority, primary, rate }   priority order,
          checkIns[]    { id, month, income, expenses, movingSavings, emergencySavings, freeSavings,
                          loanBalances[] { loanId, balance }, goalBalances[] { goalId, balance },
                          lines[] (D32), deposits[] { pot, goalId, goalName, planned, amount } (D33),
                          frozen | null } } }
```

- Amounts are **strings** in euros with exactly 2 decimals and a dot (`"1234.50"`, `"-0.05"`),
  converted from integer cents, so no precision is lost. Rates (`apr`, `riskFreeRate`,
  `earlyRepaymentPct`) are fractions as stored. Months are `YYYY-MM`; `null` = empty.
- Empty collections are empty arrays; `settings` is `null` before onboarding.
- `version` changes whenever the shape changes; an import must check `format` and `version`.
  Version 1 (#7) had no `penaltyPct` / `penaltyCapMonths` (read them as `null`); version 2 adds them (D22);
  version 3 adds `goals` and `goalBalances` (D23; older files: the moving fund only, no goal balances);
  version 4 adds the loans' `kind` and `creditLimit` (D24; older files: `"loan"`, `null`);
  version 5 stores the primary goal like the others: `settings` loses the moving fund and check-ins lose
  `movingSavings` (its value is the primary goal's entry in `goalBalances`);
  version 6 adds the settings' `expenseInflationRate` and `incomeGrowthRate` and the lines' `indexed`
  (D27; older files: `0`, `0`, `true`); version 7 adds the settings' `emergencyRate` and `freeSavingsRate`
  and the goals' `rate` (D28; older files: `0`); version 8 adds the lines' `paydayDay` and
  `paydayPreviousMonth` and `incomePayments[] { month, budgetLineId, paidOn }` (D29; older files: `1`,
  `false`, `[]`); version 9 adds `bankCsvMapping` (D30; older files: `null`); version 10 adds `bankRules[] { keyword, budgetLineId }`
  and `bankLineTotals[] { month, budgetLineId, actual }` (D31; older files: `[]`); version 11 adds the check-ins'
  `lines[] { kind, direction, category, budgetLineId, exceptionId, label, planned, actual }` (D32; older files: `[]`)
  and drops `bankLineTotals`; version 12 adds the check-ins' `deposits[]` (D33; with deposits the
  balances are computed and exported as 0 / empty; older files: `[]`, typed balances).

### 10.2 Plan CSV, `finance-plan-YYYY-MM-DD.csv`

- UTF-8 with BOM, CRLF line ends, one header row and one row per plan month (300).
- Columns: `Mois` (`YYYY-MM`), `N°`, then the monthly amounts (income, of which exceptions,
  expenses, of which exceptions, loan payments, available, moving paid / cumulative, emergency
  paid / cumulative, remainder, early repayment, unused early repayment, free savings paid /
  cumulative, savings interest (D28), interest, remaining debt), one `Restant dû <crédit>` column per active loan, and
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
