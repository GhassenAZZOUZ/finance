import { openPaywall } from "@/lib/billing/paywall";
import { limitOf } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";
import { type FinanceRepository, RepositoryError } from "./repository";
import { SupabaseFinanceRepository } from "./supabase-repository";

let offline = false;

/** The Android app shows its offline copy (#84, AC-07): every write is refused until it reconnects. */
export function setOfflineMode(value: boolean): void {
  offline = value;
}

export function isOfflineMode(): boolean {
  return offline;
}

/**
 * Repository bound to the browser session (RLS applies); read-only while offline. A write refused
 * for a Free limit (#139) opens the paywall (#140), then rejects as before for the form's message.
 */
export function getRepository(): FinanceRepository {
  const repo = withPaywall(new SupabaseFinanceRepository(supabaseBrowser()));
  return offline ? readOnly(repo) : repo;
}

function withPaywall(repo: FinanceRepository): FinanceRepository {
  return new Proxy(repo, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!(result instanceof Promise)) return result;
        return result.catch((error: unknown) => {
          const limit = limitOf(error);
          if (limit) openPaywall(limit);
          throw error;
        });
      };
    },
  });
}

/** Every method but `load` rejects with the « offline » error. */
function readOnly(repo: FinanceRepository): FinanceRepository {
  return new Proxy(repo, {
    get(target, name, receiver) {
      if (name === "load") return Reflect.get(target, name, receiver);
      return async () => {
        throw new RepositoryError("Offline: read-only", "offline");
      };
    },
  });
}

const listeners = new Set<() => void>();

/** Called by form actions after a successful write: the data provider reloads. */
export function notifyDataChanged(): void {
  for (const listener of listeners) listener();
}

export function onDataChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
