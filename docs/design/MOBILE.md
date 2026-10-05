# Mobile app — handoff spec

Mockups (390 px wide, one `.dc.html` per screen, demo seed data — never hard-code the numbers):

| Mockup | Route | Notes |
|---|---|---|
| `Mobile.dc.html` | `/` | Home |
| `MobileSaisie.dc.html` | `/suivi?mois=…` (mobile) | Full-screen 3-step check-in |
| `MobileBudget.dc.html` | `/budget` | List view |
| `MobileBudgetSheet.dc.html` | `/budget` | Bottom sheet to edit one line |
| `MobileCredits.dc.html` | `/credits` | Loan cards |
| `MobilePlan.dc.html` | `/plan` | Month cards instead of the table |
| `MobilePlus.dc.html` | `/plus` (new, mobile only) | Secondary navigation |

**Breakpoint:** everything here applies **below `md` (768 px)**. Desktop layouts stay unchanged.
Build mobile-specific components where the structure differs (Plan, Budget, Suivi), not CSS hacks on
the desktop table/forms. Engine, domain, data layer untouched.

## 1. Shell (`components/app/nav.tsx`)

- **Bottom tab bar, 5 slots** (replaces the 6-item bar): Accueil `/` · Budget `/budget` ·
  **Saisir** (center, 56 px raised ink button, `+` icon, pending-months badge from
  `usePendingCheckIns()`, links to `checkInHref(oldest)`; when nothing is pending → current month) ·
  Crédits `/credits` · Plus `/plus`.
- Labels 11 px, items ≥ 50 px tall, `pb-[env(safe-area-inset-bottom)]`, `aria-current="page"`.
  "Plus" is active on `/plus`, `/plan`, `/simuler`, `/donnees`, `/import`, `/rappel`.
- Remove the mobile top bar account menu: account, theme, tour and sign-out move to `/plus`.
  Home keeps a small header (logo + "Boussole" + month pill); other pages start with a large serif
  title (32 px), no global header.
- Main content: `pb-28` so nothing hides behind the tab bar.

## 2. Screens

### Home (`/`)
1. Headline sentence (serif 27 px) — same generator as desktop.
2. Dark "margin" card: margin of the reference month (46 px), stacked bar expenses/payments/margin,
   3 mini figures, debt-ratio status.
3. Check-in shortcut row (only when pending): "Saisir {mois}" + "N mois en attente".
4. Horizontally scrollable KPI cards (`overflow-x-auto snap-x`, cards 156 px, edge-to-edge): Dettes
   (→ `/credits`), Épargne, Intérêts évités.
5. Moving-fund warning with the 2 fixes as full-width 52 px buttons (only when `!movingGoalMet`).
6. "Prochaines étapes": next 4 milestones as a vertical list (from `findMilestones()`), link to Plan.
7. Goal meters. No charts on mobile home (they stay on desktop / Plan).

### Check-in (`/suivi`, mobile)
- Full-screen flow, **no tab bar**; close (×) returns to the previous page.
- 3 steps with a progress bar: **1 Épargne** (moving, emergency, free) · **2 Crédits** (one field per
  active loan) · **3 Vérifier** (gaps + provisional status + optional income/expenses + Save).
- "Tout est comme prévu" fills the current step with planned values.
- One card per field: label, "prévu X €", large input (56 px, 22 px text, `inputMode="decimal"`),
  chips "= prévu" / "Même que {mois précédent}", live gap line (✓ / ↑ / ↓ with the ±10 € tolerance).
- Sticky footer: "n sur 3" + primary "Suivant : …" (52 px). Keep the existing server action; steps are
  client state only, one submit at step 3. History + "Recaler le plan" move below on the regular page.

### Budget (`/budget`, mobile)
- Sticky header: title, margin card with the stacked bar, segmented control
  **Mois type · Ponctuel · Objectifs** (= lines · exceptions · plan parameters).
- Lines as grouped lists (label · amount · chevron, rows ≥ 52 px); a period shows as a green subtitle
  ("jusqu'en déc. 2026"); 0 € lines collapsed behind "Afficher"; "+ Ajouter …" row per group;
  last group "Mensualités de crédit" links to Crédits.
- Tapping a row opens a **bottom sheet** (`role="dialog"`, `aria-modal`, focus trap, Esc / backdrop /
  × close, drag handle): amount (64 px, 30 px text), label, period chips
  (Tous les mois / À partir de… / Jusqu'à… → reveal month inputs), delete (inline confirm) + Save.
  Show "Nouvelle marge : …" live.
- **Saves per line** (each sheet save calls the existing budget action with the full payload); no
  global "Enregistrer" on mobile.

### Crédits (`/credits`, mobile)
- Dark totals card: remaining principal, payments/month, interest avoided, weighted APR.
- "Remboursés en priorité": one card per eligible loan in priority order — badge, name, APR · payment,
  balance, % repaid bar, "Soldé en {mois}" + "N mois plus tôt" pill.
- "Remboursement normal": compact rows for the others (APR · end month · balance).
- Tap → edit in a full-height sheet (same fields as desktop `LoanForm`). "+ Ajouter" pill in the
  header, disabled at `MAX_ACTIVE_LOANS` with "6 crédits sur 6".

### Plan (`/plan`, mobile)
- Back button to Plus, chips 18 mois / 5 ans / 25 ans (same `?mois=` param), colour legend.
- Sticky year headers naming the active phase.
- One card per month: name + event chip, available amount, **allocation bar** (share of
  moving / emergency / early repayment / free savings), one line "{bucket} {cumul} · Dettes {reste}".
  Tap expands the full breakdown (`<details>` or disclosure button). Current month outlined; deadline
  and negative months tinted.
- Consecutive identical months may be collapsed ("Février à avril : identiques à janvier").

### Plus (`/plus`, new route, mobile only; on desktop redirect to `/`)
Account card · **Outils**: Plan, Et si… ?, Historique du suivi · **Mes données**: Exporter,
Importer, Rappel mensuel · **Préférences**: Thème (Clair/Sombre/Auto segmented), Revoir la visite ·
Se déconnecter (red text, existing `SignOutButton`).

## 3. Mobile rules (apply everywhere < md)
- Inputs ≥ 16 px font (prevents iOS zoom), `inputMode="decimal"` for amounts, `type="month"` for months.
- Tap targets ≥ 44 px (primary actions 52 px). No hover-only affordances.
- No horizontal page scroll; only intentional carousels scroll sideways.
- Sticky elements respect `env(safe-area-inset-*)` (standalone PWA mode).
- Sheets: `max-h-[90dvh]`, scroll inside, footer buttons stay visible above the keyboard.

## 4. Tests
- Component tests for the tab bar (5 items, active state, badge), the check-in steps (next/previous,
  "Tout est comme prévu", submit only at step 3), the budget sheet (open, edit, save, delete confirm).
- Playwright (if added): `devices['iPhone 13']` smoke per route + no horizontal overflow check
  (`document.documentElement.scrollWidth <= innerWidth`).

## Suggested order (one PR each)
1. Shell (tab bar + `/plus`) · 2. Home · 3. Check-in flow · 4. Budget list + sheet · 5. Crédits · 6. Plan.
