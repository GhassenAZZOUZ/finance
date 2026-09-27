# UI redesign — handoff spec

Static mockups (one `.dc.html` per screen, inline styles) of the redesign. **Reference only**: they are
not part of the app build. Numbers in them are a snapshot of the demo seed (`supabase/seed.sql`),
computed for September 2026 — never hard-code them; every value comes from `useFinance()` / the engine.

| Mockup | Route | Main files to change |
|---|---|---|
| `Main.dc.html` | `/` | `app/(app)/view.tsx`, `app/(app)/_dashboard/*` |
| `Mobile.dc.html` | `/` (< md) | same + `components/app/nav.tsx` (`MobileNav`) |
| `Budget.dc.html` | `/budget` | `app/(app)/budget/budget-form.tsx`, `budget-summary.tsx`, `exceptions-card.tsx` |
| `Credits.dc.html` | `/credits` | `app/(app)/credits/view.tsx`, `loans-manager.tsx`, `loan-form.tsx` |
| `Plan.dc.html` | `/plan` | `app/(app)/plan/view.tsx`, `plan-table.tsx` |
| `Suivi.dc.html` | `/suivi` | `app/(app)/suivi/view.tsx`, `check-in-form.tsx`, `history.tsx`, `rebase-card.tsx` |

## Scope and constraints

- **Do not touch** `lib/engine/`, `lib/domain/`, `lib/data/`, `supabase/`. UI layer only, except §5.
- Keep shadcn/ui primitives (`Card`, `Button`, `Input`, `Label`, `Alert`…): restyle through tokens, do not
  paste mockup HTML.
- Keep every existing accessibility behaviour (labels, `aria-*`, focus management, inline delete
  confirmations, sr-only chart summaries, skip link). Touch targets ≥ 44 px.
- `npm run verify` must stay green; update component tests where markup/labels change.
- French copy as in the mockups; `fr-FR` formatting via `lib/format.ts` (SPEC D12).

## 1. Design tokens (`app/globals.css`)

Replace the neutral shadcn palette in `:root` (light only for now; keep `.dark` working, derive later):

| Token | Value | Use |
|---|---|---|
| `--background` | `#F3F0E8` | page (warm paper) |
| `--card` / `--popover` | `#FFFFFF` | surfaces |
| `--foreground` | `#1D1C19` | ink |
| `--muted-foreground` | `#57534B` | secondary text (≥ 4.5:1 on paper) |
| `--border` / `--input` | `#DDD7CA` / `#D6CFBF` | lines, inputs |
| `--primary` / `--primary-foreground` | `#1D1C19` / `#F3F0E8` | primary buttons, active nav |
| `--sidebar` | `#EAE6DB` | desktop sidebar |
| `--radius` | `0.75rem` (cards 16 px, inputs 10 px) | |

Bucket colours (add as `--bucket-*` and map in `components/app/tones.ts`, replacing `PLAN_GROUP` hexes):

| Bucket | Fill | Text on tint |
|---|---|---|
| ① Moving (`moving`) | `#D39A36` | `#8A5A12` on `#FBF1DD` |
| ② Emergency (`emergency`) | `#24503F` | `#24503F` on `#E3ECE7` |
| Debt / early repayment (`debts`) | `#B04A32` | `#7E2B1B` on `#F6E1DA` |
| Free savings (`remainder`) | `#8C86C9` (lines `#6D67B3`) | `#2C2A55` on `#C9C6E6` |
| Expenses / payments | `#C9C1B1` / `#8A8375` | |

Status: good `#2F6B4F` (bg `#F1F7F3`), warning `#8A5A12` (bg `#FBF1DD`, border `#E8CF9C`), bad `#A2362A`.
Replace the `text-green-800 / amber / red-700` literals in `kpi.tsx`, `status-badge.tsx`, forms.

Fonts (`app/layout.tsx`, `next/font/google`): **Newsreader** (display: page titles, hero amounts,
`font-heading`) + **IBM Plex Sans** (body, `font-sans`). All amounts `tabular-nums`.

## 2. App shell

- Desktop (≥ md): fixed left sidebar 248 px (brand, 5 nav links with icons, Suivi badge = number of
  check-in months not yet entered, "À faire" card with CTA to the oldest missing month, email + sign-out).
  Replaces the top header nav.
- Mobile: keep the bottom tab bar; active tab = ink + top indicator; same Suivi badge.
- Page header: serif `h1` 42 px (28 px mobile) + one-line description.

## 3. Screens

### Dashboard (`/`)
1. Eyebrow `"{mois courant} · mois N sur 300"` + generated headline sentence from KPIs
   (debt-free month; moving status). Buttons: "Voir le plan", "Saisir {oldest missing month}".
2. Three stat tiles: Marge mensuelle (stacked bar expenses/payments/margin, debt ratio + alert),
   Dettes restantes (current plan-month debt, % repaid since start, weighted APR, debt-free month and
   months gained vs baseline), Épargne constituée (moving + emergency + free, value at month 12).
3. Moving-fund warning (only when `!movingGoalMet`): shortfall at deadline + 2 fix options (§5).
4. **Feuille de route**: horizontal timeline, one band per allocation phase (moving → emergency →
   early repayment + free savings → free savings), "Aujourd'hui" marker, milestone dots; milestone list
   below (loan payoffs, deadline, emergency reached, debt-free). Source: `findMilestones()` + `plan.result`.
5. Debt vs free savings chart (24 months, existing Recharts `PlanLineChart`, new colours, "today" line)
   + goal meters (moving: actual + hatched projection to deadline; emergency; free savings).
6. Suivi strip (last 3 check-in months with status) + early-repayment order (priority, APR, payoff).
   The actual-vs-planned charts move to `/suivi`.

### Budget (`/budget`)
- Sections as cards with a coloured dot + total in the header; line row = label | period toggle |
  amount | delete. Zero-amount lines collapsed behind "Afficher" (still saved).
- Exceptions: 12-month strip (current month highlighted, months with exceptions marked) + one-row add form
  with a Revenu/Dépense segmented control.
- Parameters grouped by fund: ① Déménagement (inline warning when `movingMonthlyNeeded > margin`),
  ② Fonds d'urgence (suggestion + "Utiliser cette valeur"), ③ Reste du mois (risk-free rate,
  early-repayment share as a range slider 0–100), then plan start + free savings existing.
- Sticky "Aperçu": cascade bars income → fixed → variable → payments → margin, debt ratio, plan results,
  Save button + saved/dirty state.

### Crédits (`/credits`)
- 4 totals: remaining principal (plan month) · monthly payments (% of income) · weighted APR (vs
  threshold) · interest saved (with vs without plan).
- Loans sorted by priority (eligible first, then the rest); row = priority badge, name + advice tag,
  balance, APR, payment, **dumbbell timeline** (payoff with plan ● vs without ○, "−N mois"), edit button.
  Edit opens inline under the row (existing `LoanForm` fields + contract-end check). Add button disabled at
  `MAX_ACTIVE_LOANS` with a note.

### Plan (`/plan`)
- Range control: 18 mois / 5 ans / 25 ans (replaces the 24/300 link; keep `?mois=` URL param).
- "Les 300 mois" overview bar: phases proportional to their length, bracket = rows shown.
- Table: month column carries event chips (today, loan paid off, deadline, fund complete, negative month,
  exception) instead of the colour-only legend; year separator rows naming the active phase; zero
  allocations shown as "—"; cumulative values as a second line. Negative months keep a red row + chip.

### Suivi (`/suivi`)
- Month selector as buttons (pending / in progress / entered + status).
- Each field row: label | planned | actual input | live gap (green/red + icon, same tolerance ±10 €).
- Optional income/expenses in a `<details>`.
- Sticky footer: provisional status (computed client-side with the engine's comparison rule) + save.
- Right column: history list, tolerance note, "Recaler le plan" card (existing flow).

## 4. Charts
Keep Recharts; colours from §1; always pair colour with marker/dash + the existing text summaries.

## 5. New logic (small, pure, unit-tested)
`movingShortfallOptions(input, result)` in `app/(app)/_dashboard/logic.ts` (UI helper, engine untouched):
- `shortfall = movingGoal − movingAmountAtDeadline` (only if > 0).
- `extraPerMonth = round2(shortfall / monthsLeft)` where `monthsLeft` = months from the reference month
  to the deadline, inclusive.
- `deadlineThatWorks` = first plan month where `movingCum(deadline) + Σ available after deadline ≥ goal`,
  or re-run `simulate()` with later deadlines (≤ 12 tries) and take the first with `movingGoalMet`.
Demo check: shortfall 488,70 €, 4 months → 122,18 €/mois; deadline → janvier 2027.

## Suggested order (one PR each)
1. Tokens + fonts + shell/nav · 2. Dashboard · 3. Plan · 4. Crédits · 5. Budget · 6. Suivi.
