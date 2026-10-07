-- Local development seed: ONE FAKE demo user with the invented values of
-- docs/plan_financier.template.xlsx. Never put real personal data here.
-- Sign in locally with a magic link to demo@example.com and open the email in Mailpit
-- (http://127.0.0.1:55324). Runs on `supabase db reset`.

do $$
declare
  demo_id uuid := '00000000-0000-4000-8000-00000000d3e0';
  auto_id uuid := '00000000-0000-4000-8000-0000000000a1';
  revolving_id uuid := '00000000-0000-4000-8000-0000000000a2';
  works_id uuid := '00000000-0000-4000-8000-0000000000a3';
  student_id uuid := '00000000-0000-4000-8000-0000000000a4';
  debt_a_id uuid := '00000000-0000-4000-8000-0000000000a5';
  debt_b_id uuid := '00000000-0000-4000-8000-0000000000a6';
  actual_id uuid;
  goal_id uuid := '00000000-0000-4000-8000-0000000000b1';
  -- Dates relative to today, so the demo always has a started plan and an enterable month.
  start_month text := to_char(date_trunc('month', now()) - interval '2 months', 'YYYY-MM');
  deadline_month text := to_char(date_trunc('month', now()) + interval '3 months', 'YYYY-MM');
begin
  if exists (select 1 from auth.users where id = demo_id) then
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', demo_id, 'authenticated', 'authenticated',
    'demo@example.com', extensions.crypt('demo-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), demo_id, demo_id::text,
          jsonb_build_object('sub', demo_id::text, 'email', 'demo@example.com', 'email_verified', true),
          'email', now(), now(), now());
  -- The signup trigger has created the profile and the 15 budget lines at 0 €.

  update public.profiles set display_name = 'Démo' where user_id = demo_id;
  -- The demo user has several loans: Pro (grant) so the Free limits (#139) do not refuse them.
  insert into public.pro_grants (user_id, reason) values (demo_id, 'gift');

  update public.budget_lines as bl set amount = v.amount
  from (values
    ('income', 0, 2800.00), ('income', 2, 100.00),
    ('fixed', 0, 850.00), ('fixed', 1, 60.00), ('fixed', 2, 35.00), ('fixed', 3, 30.00),
    ('fixed', 4, 75.00), ('fixed', 5, 25.00),
    ('variable', 0, 350.00), ('variable', 1, 150.00), ('variable', 2, 100.00), ('variable', 3, 50.00)
  ) as v(category, position, amount)
  where bl.user_id = demo_id and bl.category = v.category and bl.position = v.position;

  insert into public.budget_settings (
    user_id, start_month, emergency_target, emergency_existing, risk_free_rate, early_repayment_pct
  ) values (demo_id, start_month, 4000, 800, 0.024, 0.6);
  -- The primary goal (the spreadsheet's moving fund, SPEC D23).
  insert into public.savings_goals (id, user_id, name, target, deadline_month, already_saved, priority)
  values (goal_id, demo_id, 'Déménagement', 4000, deadline_month, 500, 1);

  insert into public.loans (id, user_id, name, type, principal, apr, monthly_payment, position) values
    (auto_id,      demo_id, 'Prêt auto',       'Prêt affecté',      8200, 0.049,  245.30, 0),
    (revolving_id, demo_id, 'Carte revolving', 'Revolving',         1850, 0.189,   72.40, 1),
    (works_id,     demo_id, 'Prêt travaux',    'Prêt personnel',    3400, 0.0615, 118.75, 2),
    (student_id,   demo_id, 'Prêt étudiant',   'Prêt étudiant',     2100, 0.012,   95.00, 3),
    (debt_a_id,    demo_id, 'Dette perso A',   'Dette personnelle',  600, 0,      150.00, 4),
    (debt_b_id,    demo_id, 'Dette perso B',   'Dette personnelle',  250, 0,       50.00, 5);

  -- One check-in for the first plan month, exactly on plan (golden 'suivi_actuals' scenario, month 1).
  insert into public.monthly_actuals (user_id, month, income, expenses, emergency_savings, free_savings)
  values (demo_id, start_month, 2900, 1725, 800, 0)
  returning id into actual_id;
  insert into public.monthly_actual_goal_balances (user_id, monthly_actual_id, goal_id, balance)
  values (demo_id, actual_id, goal_id, 943.55);
  insert into public.monthly_actual_loan_balances (user_id, monthly_actual_id, loan_id, balance) values
    (demo_id, actual_id, auto_id, 7988.18),
    (demo_id, actual_id, revolving_id, 1806.74),
    (demo_id, actual_id, works_id, 3298.68),
    (demo_id, actual_id, student_id, 2007.10),
    (demo_id, actual_id, debt_a_id, 450.00),
    (demo_id, actual_id, debt_b_id, 200.00);
end;
$$;
