import "server-only";
import { redirect } from "next/navigation";
import { computePlan, type ComputedPlan } from "@/lib/domain/plan";
import type { FinanceSnapshot } from "@/lib/domain/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FinanceRepository } from "./repository";
import { SupabaseFinanceRepository } from "./supabase-repository";

/** Repository bound to the signed-in user's session (RLS applies). */
export async function getRepository(): Promise<FinanceRepository> {
  return new SupabaseFinanceRepository(await createSupabaseServerClient());
}

export interface PageData {
  email: string | null;
  snapshot: FinanceSnapshot;
  /** Null until the budget parameters are saved (onboarding). */
  plan: ComputedPlan | null;
}

/** Everything a page needs: the user's data and the simulated plan. Redirects to /login if signed out. */
export async function loadPageData(): Promise<PageData> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const snapshot = await new SupabaseFinanceRepository(supabase).load();
  return {
    email: typeof data.claims.email === "string" ? data.claims.email : null,
    snapshot,
    plan: computePlan(snapshot),
  };
}
