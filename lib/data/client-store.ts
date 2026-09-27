import { supabaseBrowser } from "@/lib/supabase/client";
import type { FinanceRepository } from "./repository";
import { SupabaseFinanceRepository } from "./supabase-repository";

/** Repository bound to the browser session (RLS applies). */
export function getRepository(): FinanceRepository {
  return new SupabaseFinanceRepository(supabaseBrowser());
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
