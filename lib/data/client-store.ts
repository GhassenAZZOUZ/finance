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

/** Repository bound to the browser session (RLS applies); read-only while offline. */
export function getRepository(): FinanceRepository {
  const repo = new SupabaseFinanceRepository(supabaseBrowser());
  return offline ? readOnly(repo) : repo;
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
