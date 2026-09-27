# finance-plan

Private, French-language personal-finance web app that reproduces the owner's spreadsheet
(`plan_financier`): a monthly **budget** with one-off exceptions (e.g. a bonus in December), up to 6
**loans** (crédits), a **month-by-month plan over 300 months** (emergency fund, moving fund, avalanche
early repayments) and **monthly check-ins** (suivi réel) compared to the plan.

The business rules are specified in [docs/SPEC.md](docs/SPEC.md) and validated against Excel.
Where the app deliberately differs from the spreadsheet, the decision is recorded in
[SPEC §2](docs/SPEC.md#2-v1-decisions-owner-validated-2026-09-27) (D1–D14).

**V1 stack:** Next.js 16 (App Router, React 19, TypeScript) · Tailwind CSS 4 + shadcn/ui ·
Recharts · Supabase (Postgres + Auth magic link + RLS) · Vitest · target hosting: Vercel.

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
  `demo@example.com`, with invented values. `supabase db reset` re-applies the migrations and the
  seed; it **wipes all local data**.

## Environment variables

| Variable | Used by | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | App | Supabase API URL (local: `http://127.0.0.1:55321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | App | Publishable key (`sb_publishable_…`) |
| `SUPABASE_URL` | Integration tests only | Local API URL |
| `SUPABASE_PUBLISHABLE_KEY` | Integration tests only | Local publishable key |
| `SUPABASE_SECRET_KEY` | Integration tests only | Local secret key, used to create/delete test users |

The three `SUPABASE_*` variables are optional locally (the tests read `supabase status`) and set
automatically in CI. The tests refuse to run against anything but `127.0.0.1`/`localhost`.

> **No service-role / secret key is ever used by the app or shipped to the browser.** The app only
> has the publishable key; every row is protected by Row Level Security in Postgres.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint (includes the engine purity guard) |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm test` | All Vitest projects (unit + integration) |
| `npm run test:unit` | Unit tests (engine golden + edge cases, validation) |
| `npm run test:integration` | Integration tests against the local Supabase |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run verify` | lint + typecheck + all tests |

## Architecture

| Path | Contents |
|---|---|
| `lib/engine/` | Pure simulation engine (money, months, simulate, projection of a principal to the plan start, normal payment rule, actuals). No framework, I/O, clock or randomness: enforced by an ESLint rule in `eslint.config.mjs` |
| `lib/domain/` | Domain types, plan assembly, input validation |
| `lib/data/` | `FinanceRepository` interface + Supabase implementation. Pages and server actions only use this interface, so the V2 import can reuse it |
| `lib/supabase/`, `proxy.ts` | Server Supabase client; `proxy.ts` refreshes the session cookie and redirects signed-out visitors to `/login` |
| `lib/labels.ts`, `lib/format.ts` | French UI labels; `fr-FR` formatting |
| `app/(app)/` | Pages: `/` dashboard, `/budget`, `/credits`, `/plan`, `/suivi` |
| `app/login/`, `app/auth/` | Magic-link login and `/auth/confirm` callback |
| `supabase/migrations/` | Schema (7 tables: `profiles`, `budget_settings`, `budget_lines`, `budget_exceptions`, `loans`, `monthly_actuals`, `monthly_actual_loan_balances`); RLS on every table (`user_id = auth.uid()`) |
| `tests/unit/` | Engine vs Excel golden data, edge cases, validation |
| `tests/integration/` | RLS isolation and repository tests |
| `scripts/` | Phase 0 tooling (Python/PowerShell): template, Excel recalculation, golden export |
| `docs/SPEC.md` | Functional spec, the engine's contract |

**Key decisions** (details in [docs/SPEC.md §2](docs/SPEC.md#2-v1-decisions-owner-validated-2026-09-27)):

- **Money is integer cents.** Rounding uses Excel `ROUND(x, 2)` semantics and happens only at the
  points listed in [SPEC §4.0](docs/SPEC.md#40-money-and-rounding-d2); everything else is exact
  cent arithmetic. The database stores `numeric(12,2)` euros; the repository converts.
- **Months are `YYYY-MM` strings.** The engine never uses `Date`.
- **Engine output is language-neutral.** French labels live in `lib/labels.ts`.
- **Loans (D5b, D5c, D13):** an optional contract end month is compared with the simulated end
  (warning if > 1 month apart); a principal read before the plan start is rolled forward to it
  using "Dernière mensualité déjà payée"; a residual under 1 € is added to the last payment, as
  banks do.
- **Budget (D14):** a regular monthly budget plus one-off exceptions (extra income or expense for a
  single month). Dashboard KPIs describe the regular month; the plan includes the exceptions.

## Testing

- **Unit** (`npm run test:unit`): the engine is checked against
  [tests/fixtures/golden.json](tests/fixtures/golden.json), values **computed by Excel** on the
  anonymized template (with the D2/D13 rules patched into the formulas), across 16 scenarios
  (300 months each), to the cent. Hand-checkable edge cases cover the rules Excel has no
  equivalent for (principal projection, one-off exceptions).
- **Integration** (`npm run test:integration`): needs `supabase start`. Proves that user B can
  neither read nor write user A's data on every table (RLS), and exercises the Supabase repository.
  Test users are created and deleted by the tests.
- **Regenerating the golden data** requires Windows + desktop Excel and Python: see
  [scripts/README.md](scripts/README.md).

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every pull request and on pushes to
`main`: lint, typecheck and unit tests, then (only if those pass) a local Supabase in the runner,
`supabase db lint` and the integration tests. It becomes active once the repository is pushed to
GitHub.

## Data & privacy

- The owner's real workbook `docs/plan_financier.xlsx` is git-ignored and must **never** be
  committed or quoted. Everything in the repo (template, fixtures, seed, docs) uses invented values.
- No IBANs, account numbers or bank credentials are stored: only balances and amounts.
- Every table has RLS; each user only sees their own rows.

## Deploying to Vercel

Not deployed yet. Steps:

1. Create a Supabase project.
2. Apply the migrations: `supabase link --project-ref <ref>` then `supabase db push`
   (do not run the seed on production).
3. In Supabase → Authentication → URL Configuration: Site URL `https://<domain>` and redirect URL
   `https://<domain>/auth/confirm`.
4. In Vercel, import the repository and set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (from the Supabase project's API settings).
5. Deploy.

## Roadmap (V2, not implemented)

- `/import`: import the Excel template (SheetJS) through the `FinanceRepository` layer.
- Playwright end-to-end tests.
