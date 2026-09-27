"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { getRepository, onDataChanged } from "@/lib/data/client-store";
import { type ComputedPlan, computePlan } from "@/lib/domain/plan";
import type { FinanceSnapshot } from "@/lib/domain/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export interface FinanceData {
  email: string | null;
  snapshot: FinanceSnapshot;
  /** Null until the budget parameters are saved (onboarding). */
  plan: ComputedPlan | null;
  reload: () => void;
}

const FinanceContext = createContext<FinanceData | null>(null);

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; email: string | null; snapshot: FinanceSnapshot; plan: ComputedPlan | null };

/** Loads the session, the user's data and the plan; "signed-out" when there is no session. */
async function fetchFinance(): Promise<State | "signed-out"> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) return "signed-out";
  try {
    const snapshot = await getRepository().load();
    return { status: "ready", email: data.session.user.email ?? null, snapshot, plan: computePlan(snapshot) };
  } catch {
    return { status: "error", message: "Impossible de charger vos données. Vérifiez votre connexion." };
  }
}

/**
 * Signed-in area of the static app: checks the session (redirects to /login), loads the user's
 * data through the repository, computes the plan, and reloads after every write.
 */
export function FinanceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(() => {
    void fetchFinance().then((next) => {
      if (next === "signed-out") router.replace("/login/");
      else setState(next);
    });
  }, [router]);

  useEffect(() => {
    load();
    const off = onDataChanged(load);
    const { data } = supabaseBrowser().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login/");
    });
    return () => {
      off();
      data.subscription.unsubscribe();
    };
  }, [load, router]);

  if (state.status === "loading") {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted-foreground">
        Chargement de vos données…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>{state.message}</p>
        <Button type="button" variant="outline" onClick={load}>
          Réessayer
        </Button>
      </div>
    );
  }
  return (
    <FinanceContext.Provider value={{ email: state.email, snapshot: state.snapshot, plan: state.plan, reload: load }}>
      {children}
    </FinanceContext.Provider>
  );
}

/** The signed-in user's data; only usable inside the (app) pages. */
export function useFinance(): FinanceData {
  const value = useContext(FinanceContext);
  if (!value) throw new Error("useFinance must be used inside <FinanceProvider>");
  return value;
}
