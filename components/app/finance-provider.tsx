"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getRepository, onDataChanged, setOfflineMode } from "@/lib/data/client-store";
import { type ComputedPlan, withPlan } from "@/lib/domain/plan";
import type { FinanceSnapshot } from "@/lib/domain/types";
import { errorMessage, reportError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { clearOfflineSnapshot, readOfflineSnapshot, saveOfflineSnapshot } from "@/lib/native/offline-cache";
import { isNativeApp } from "@/lib/native/platform";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export interface FinanceData {
  email: string | null;
  snapshot: FinanceSnapshot;
  /** Null until the budget parameters are saved (onboarding). */
  plan: ComputedPlan | null;
  /** Android app without network (#84): when the offline copy shown was loaded; null online. */
  offlineSince: string | null;
  reload: () => void;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; email: string | null; snapshot: FinanceSnapshot; plan: ComputedPlan | null; offlineSince: string | null };

/** Ready data, or null while loading / on error. */
const FinanceContext = createContext<FinanceData | null>(null);
/** Loading state for <FinanceGate>. */
const LoadStateContext = createContext<{ state: State; reload: () => void } | null>(null);

/** The Android app's offline copy as a read-only state (#84, AC-07), or null when there is none. */
async function offlineState(userId?: string): Promise<State | null> {
  const cached = await readOfflineSnapshot(userId);
  if (!cached) return null;
  setOfflineMode(true);
  const { snapshot, plan } = withPlan(cached.snapshot);
  return { status: "ready", email: cached.email, snapshot, plan, offlineSince: cached.savedAt };
}

/** Loads the session, the user's data and the plan; "signed-out" when there is no session. */
async function fetchFinance(): Promise<State | "signed-out"> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) {
    // Without network the session cannot be refreshed: the app still shows its offline copy.
    const fallback = isNativeApp() && !navigator.onLine ? await offlineState() : null;
    return fallback ?? "signed-out";
  }
  const user = data.session.user;
  try {
    setOfflineMode(false);
    const loaded = await getRepository().load();
    void saveOfflineSnapshot({ userId: user.id, email: user.email ?? null, savedAt: new Date().toISOString(), snapshot: loaded });
    // Check-in balances are computed from the deposits (SPEC D33) before any page reads them.
    const { snapshot, plan } = withPlan(loaded);
    return { status: "ready", email: user.email ?? null, snapshot, plan, offlineSince: null };
  } catch (error) {
    reportError(error, "finance.load");
    return (
      (await offlineState(user.id)) ?? {
        status: "error",
        message: errorMessage(error, "Impossible de charger vos données. Vérifiez votre connexion."),
      }
    );
  }
}

/**
 * Signed-in area of the static app: checks the session (redirects to /login), loads the user's
 * data through the repository, computes the plan, and reloads after every write. The whole shell
 * sits inside it (the sidebar shows the pending check-ins); pages sit inside <FinanceGate>.
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
      if (event === "SIGNED_OUT") {
        void clearOfflineSnapshot();
        router.replace("/login/");
      }
    });
    // Back online: fresh data, writes allowed again.
    window.addEventListener("online", load);
    return () => {
      off();
      data.subscription.unsubscribe();
      window.removeEventListener("online", load);
    };
  }, [load, router]);

  const data = useMemo<FinanceData | null>(
    () =>
      state.status === "ready"
        ? { email: state.email, snapshot: state.snapshot, plan: state.plan, offlineSince: state.offlineSince, reload: load }
        : null,
    [state, load],
  );
  const loadState = useMemo(() => ({ state, reload: load }), [state, load]);

  return (
    <LoadStateContext.Provider value={loadState}>
      <FinanceContext.Provider value={data}>{children}</FinanceContext.Provider>
    </LoadStateContext.Provider>
  );
}

/** Renders the page once the data is loaded; a status line while loading, a retry on error. */
export function FinanceGate({ children }: { children: ReactNode }) {
  const value = useContext(LoadStateContext);
  if (!value) throw new Error("FinanceGate must be used inside <FinanceProvider>");
  const { state, reload } = value;
  if (state.status === "loading") {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted-foreground">
        Chargement de vos données…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-bad-border bg-bad-bg p-4 text-sm text-bad">
        <p>{state.message}</p>
        <Button type="button" variant="outline" onClick={reload}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (state.offlineSince) {
    return (
      <>
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning"
        >
          <span>Hors ligne : vos données du {offlineDate(state.offlineSince)}, en lecture seule.</span>
          <Button type="button" variant="outline" className="min-h-10" onClick={reload}>
            Réessayer
          </Button>
        </div>
        {children}
      </>
    );
  }
  return children;
}

/** « 06/10/2026 à 08:30 », in the phone's time zone. */
function offlineDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The signed-in user's data; only usable inside the (app) pages (below <FinanceGate>). */
export function useFinance(): FinanceData {
  const value = useContext(FinanceContext);
  if (!value) throw new Error("useFinance must be used inside <FinanceProvider> and <FinanceGate>");
  return value;
}

/** Same data for the shell, which also renders while loading: null until it is ready. */
export function useOptionalFinance(): FinanceData | null {
  return useContext(FinanceContext);
}
