# finance-plan

Private, French-language personal-finance web app that reproduces the owner's spreadsheet
(`plan_financier`) and goes further:

- **Budget**: monthly income and expenses, lines that start or stop in a given month, one-off
  exceptions (e.g. a bonus in December).
- **Crédits**: up to 6 active loans, with an optional contract end check and early-repayment
  penalties (IRA).
- **Plan**: month by month over 300 months: moving fund, emergency fund, then avalanche early
  repayments and free savings.
- **Suivi**: monthly check-ins compared with the plan, actual vs planned charts, and « Recaler le
  plan » to restart the plan from the real balances without rewriting the history.
- **Et si… ?**: a simulator that compares changes with the saved plan, without saving anything.
- **Mes données**: JSON backup, 300-month plan as CSV, and import of the Excel template.
- Light and dark themes; installable on a phone (web app manifest).

Live: <https://ghassenazzouz.github.io/finance/>

The business rules are specified in [docs/SPEC.md](docs/SPEC.md) and validated against Excel.
Every deliberate difference from the spreadsheet, and every rule added since, is recorded in
[SPEC §2](docs/SPEC.md#2-v1-decisions-owner-validated-2026-09-27) (D1–D22).

**Stack:** Next.js 16 (App Router, React 19, TypeScript, static export) · Tailwind CSS 4 +
shadcn/ui · Recharts · Supabase (Postgres + Auth magic link + RLS) · Vitest + Testing Library ·
Playwright · GitHub Actions · GitHub Pages.

## Quick start

Works on Windows, macOS and Linux.

**Prerequisites:** Node.js ≥ 24, Docker (Desktop or Engine), [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 2.x.

```sh
npm ci
supabase start                 # local stack in Docker, applies migrations + seed
cp .env.example .env.local     # then fill in the values printed by `supabase status`
npm run dev                    # http://localhost:3000
```

- **Ports:** the local stack uses `553xx` ports (API `55321`, DB `55322`, Studio `55323`,
  Mailpit `55324`) instead of the default `543xx`, so it can run alongside other local Supabase
  projects. See [supabase/config.toml](supabase/config.toml).
- **Sign in:** enter an email on `/login` to receive a magic link. Locally no email leaves your
  machine: open it in **Mailpit** at <http://127.0.0.1:55324>.
- **Demo data:** [supabase/seed.sql](supabase/seed.sql) creates a **fake** demo user,
  `demo@example.com`, with invented values (dates relative to today). `supabase db reset`
  re-applies the migrations and the seed; it **wipes all local data**.

## Environment variables

| Variable | Used by | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | App | Supabase API URL (local: `http://127.0.0.1:55321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | App | Publishable key (`sb_publishable_…`) |
| `NEXT_PUBLIC_BASE_PATH` | App build | Path on GitHub Pages (`/finance`); empty locally |
| `NEXT_PUBLIC_SENTRY_DSN` | App build, optional | Sentry DSN; unset → errors go to the console only (`lib/errors.ts`) |
| `SUPABASE_URL` | Integration / E2E tests only | Local API URL |
| `SUPABASE_PUBLISHABLE_KEY` | Integration / E2E tests only | Local publishable key |
| `SUPABASE_SECRET_KEY` | Integration / E2E tests only | Local secret key, used to create/delete test users |

The three `SUPABASE_*` variables are optional locally (the tests read `supabase status`) and set
automatically in CI. The tests refuse to run against anything but `127.0.0.1`/`localhost`.

> **No service-role / secret key is ever used by the app or shipped to the browser.** The app only
> has the publishable key; every row is protected by Row Level Security in Postgres, and signed-in
> users only hold select/insert/update/delete on their own rows (Supabase security advisor clean).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Static export into `out/` |
| `npm run build:pages` | Static export + GitHub Pages post-processing (used by CI) |
| `npm run lint` | ESLint (includes the engine purity guard and `no-floating-promises`) |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm test` | All Vitest projects (unit + components + integration) |
| `npm run test:unit` | Unit tests (engine golden + edge cases, validation, view helpers, import/export) |
| `npm run test:components` | Rendered component tests (Testing Library + jsdom, mocked repository) |
| `npm run test:integration` | Integration tests against the local Supabase |
| `npm run test:e2e` | Browser journeys (Playwright) against the local Supabase, desktop + 375 px |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run verify` | lint + typecheck + all Vitest tests (run before every commit) |

## Architecture

| Path | Contents |
|---|---|
| `lib/engine/` | Pure simulation engine: money, months, simulate (avalanche, one-off extra repayments, IRA penalties), projection of a principal to the plan start, normal payment rule, actuals comparison. No framework, I/O, clock or randomness: enforced by an ESLint rule in `eslint.config.mjs` |
| `lib/domain/` | Domain types, plan assembly, input validation, plan re-basing |
| `lib/data/` | `FinanceRepository` interface + Supabase implementation; `client-store.ts` gives the browser's repository and the "data changed" signal. Forms, import and export only use this interface |
| `lib/import/` | Template import: a dependency-free `.xlsx` reader (browser `DecompressionStream`, cached values only), template parsing with the form rules, and the apply step |
| `lib/export/` | JSON backup and CSV plan builders (pure) + the browser download helper |
| `lib/supabase/` | Browser Supabase client (PKCE magic link, session kept in the browser) |
| `lib/theme.ts` | Light / dark theme choice (Système / Clair / Sombre), stored on the device |
| `lib/labels.ts`, `lib/format.ts` | French UI labels; `fr-FR` formatting |
| `components/app/` | App shell: sidebar and mobile tab bar (`nav.tsx`), `finance-provider.tsx` (session guard: redirects to `/login`, loads the data and the plan, reloads after writes), theme toggle, colour tokens (`tones.ts`) |
| `app/(app)/` | Pages: `/` dashboard, `/budget`, `/credits`, `/plan`, `/suivi`, `/simuler`, `/donnees` (« Mes données »: export), `/import`. Each is a static `page.tsx` + a client `view.tsx`; form actions run in the browser |
| `app/login/`, `app/auth/confirm/` | Magic-link login and the page that completes it |
| `app/manifest.ts`, `public/icons/` | Web app manifest and icons (installable app) |
| `app/globals.css` | Design tokens (Tailwind 4 `@theme`): colours with light and dark values, fonts (IBM Plex Sans, Newsreader) |
| `supabase/migrations/` | Schema (7 tables: `profiles`, `budget_settings`, `budget_lines`, `budget_exceptions`, `loans`, `monthly_actuals`, `monthly_actual_loan_balances`); RLS on every table (`user_id = auth.uid()`) |
| `tests/unit/` | Engine vs Excel golden data, edge cases, validation, view helpers, import/export, theme |
| `tests/components/` | Rendered component tests with a mocked repository |
| `tests/integration/` | RLS isolation, repository, import and export against the local Supabase |
| `e2e/` | Playwright journeys: login, budget, loans, check-in |
| `scripts/` | Phase 0 tooling (Python/PowerShell): template, Excel recalculation, golden export, reference engine; `prepare-pages.mjs` and `serve-static.mjs` for the static build |
| `docs/SPEC.md` | Functional spec, the engine's contract |
| `docs/design/` | UI redesign mockups and handoff notes (reference only, not built) |

**Key decisions** (details in [docs/SPEC.md §2](docs/SPEC.md#2-v1-decisions-owner-validated-2026-09-27)):

- **Money is integer cents.** Rounding uses Excel `ROUND(x, 2)` semantics and happens only at the
  points listed in [SPEC §4.0](docs/SPEC.md#40-money-and-rounding-d2); everything else is exact
  cent arithmetic. The database stores `numeric(12,2)` euros; the repository converts.
- **Months are `YYYY-MM` strings.** The engine never uses `Date`.
- **Engine output is language-neutral.** French labels live in `lib/labels.ts`.
- **Loans (D5b, D5c, D13, D22):** an optional contract end month is compared with the simulated end
  (warning if > 1 month apart); a principal read before the plan start is rolled forward to it; a
  residual under 1 € is added to the last payment, as banks do; optional early-repayment penalties
  (IRA) are paid from the early-repayment budget, and a loan is skipped when the penalty costs more
  than the interest it would save.
- **Budget (D14, D15):** budget lines may have a start and/or end month, and one-off exceptions add
  income or expenses to a single month. Dashboard KPIs describe the current month.
- **Suivi (D16):** each check-in freezes the planned values it was compared with, so changing or
  re-basing the plan never rewrites past gaps.
- **Simulator (D17):** « Et si… ? » never writes; one-off extra repayments exist only there.
- **Data (D18, D20):** export and import run entirely in the browser; import replaces the budget and
  the active loans and keeps check-ins and exceptions.

## Testing

- **Unit** (`npm run test:unit`): the engine is checked against
  [tests/fixtures/golden.json](tests/fixtures/golden.json), values **computed by Excel** on the
  anonymized template (with the D2/D13 rules patched into the formulas), across 16 scenarios
  (300 months each), to the cent. Hand-checkable edge cases cover the rules Excel has no
  equivalent for (principal projection, exceptions, dated lines, extra repayments, penalties).
- **Components** (`npm run test:components`): forms and pages rendered with Testing Library,
  with the repository mocked (inputs, errors, confirmations, "nothing is written" checks).
- **Integration** (`npm run test:integration`): needs `supabase start`. Proves that user B can
  neither read nor write user A's data on every table (RLS), and exercises the Supabase
  repository, the import and the export. Test users are created and deleted by the tests.
- **End-to-end** (`npm run test:e2e`, [e2e/](e2e/)): needs `supabase start` (with the mail catcher)
  and, the first time, `npx playwright install chromium`. Login with the real magic link read from
  the local Mailpit, then budget, loans and check-in journeys, each with its own throwaway user, on
  a desktop and a 375 px project. Locally it reuses `npm run dev` on :3000; CI builds the static
  export and serves it (`scripts/serve-static.mjs`). Failure traces and screenshots are uploaded
  as the `playwright-report` artifact.
- **Regenerating the golden data** requires Windows + desktop Excel and Python: see
  [scripts/README.md](scripts/README.md).

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every pull request and on every push
to `main`:

| Job | Runs | Needs |
|---|---|---|
| `checks` | lint, typecheck, unit and component tests | — |
| `integration` | local Supabase in the runner, `supabase db lint`, integration tests | `checks` |
| `e2e` | its own local Supabase, static build, Playwright journeys | `checks` |
| `migrate` | `main` only: pending migrations to the hosted Supabase | all of the above |
| `deploy` | `main` only: static build published to GitHub Pages | all of the above |

## Data & privacy

- The owner's real workbook `docs/plan_financier.xlsx` is git-ignored and must **never** be
  committed or quoted. Everything in the repo (template, fixtures, seed, docs) uses invented values.
- No IBANs, account numbers or bank credentials are stored: only balances and amounts.
- Every table has RLS; each user only sees their own rows.
- Export and import happen in the browser: no file is uploaded anywhere.
- « Mes données » › « Supprimer mon compte » deletes the account and every row of the user at once
  (`delete_my_account()`, SPEC D26). The hosted project's backups keep them until their retention ends.

## Deploying (GitHub Pages)

The app is a **static export** (`output: "export"`): there is no Node server. The browser talks to
Supabase directly with the publishable key; Row Level Security protects every row. Hosted Supabase
project: `finance-plan`, region eu-west-3.

How it deploys, on every push to `main` once the checks, integration and E2E tests pass:

1. The `migrate` job links the hosted project and runs `supabase db push`: only the migrations
   missing from the remote history are applied, never the seed. A failed migration stops the
   deployment. **Migrations reach the hosted database only this way**: do not apply them by hand
   (a different version number in the remote history would make the next push re-run them).
2. The `deploy` job runs `npm run build:pages` (`next build` +
   [scripts/prepare-pages.mjs](scripts/prepare-pages.mjs): `.nojekyll` and flattened
   segment-prefetch files) with the base path `/<repository name>`, then publishes `out/`.

One-time setup (already done for this repository):

1. Supabase project: Authentication → URL configuration: Site URL
   `https://<user>.github.io/<repo>/`, redirect URL `https://<user>.github.io/<repo>/**`.
2. GitHub → Settings → Pages → Source: **GitHub Actions**. Free Pages requires a public repository.
3. GitHub → Settings → Secrets and variables → Actions → **Variables**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public values, not secrets),
   optionally `NEXT_PUBLIC_SENTRY_DSN` (Sentry project → Client Keys);
   **Secret**: `SUPABASE_ACCESS_TOKEN` (Supabase account → Access tokens), used only by the `migrate`
   job. No database password is needed: the CLI logs in with a temporary role created through the token.

Preview the static build locally, as the E2E job does (no base path): `npm run build:pages`, then
`node scripts/serve-static.mjs out 3000`. To check the Pages base path, build with
`NEXT_PUBLIC_BASE_PATH=/finance` and serve `out/` under `/finance/` with any static server.

## Backups

A weekly workflow stores an age-encrypted dump of the hosted database in a private repository. Setup
(key, deploy key, variables) and restore: [docs/BACKUPS.md](docs/BACKUPS.md).

## Roadmap

Open work is tracked in [GitHub issues](https://github.com/GhassenAZZOUZ/finance/issues):

- Log in with a 6-digit code as well as the magic link ([#3](https://github.com/GhassenAZZOUZ/finance/issues/3)): needs custom SMTP and the Supabase email template.
- Monthly check-in reminder by e-mail, the rest of [#6](https://github.com/GhassenAZZOUZ/finance/issues/6) (the app is already installable).
- Several savings goals, not only the move ([#10](https://github.com/GhassenAZZOUZ/finance/issues/10)).
- Bank overdraft as its own debt type ([#28](https://github.com/GhassenAZZOUZ/finance/issues/28)).
