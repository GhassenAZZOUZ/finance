/**
 * Offline read-only view of the Android app (issue #84, AC-07): the last data loaded is kept on the
 * phone, encrypted with a key of the Android Keystore (secure storage), and shown when the app cannot
 * reach Supabase. One user at a time; deleted when that user signs out. The website keeps nothing.
 */
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";
import type { FinanceSnapshot } from "@/lib/domain/types";
import { isNativeApp } from "./platform";

const KEY = "boussole.offline-snapshot";

export interface OfflineSnapshot {
  userId: string;
  email: string | null;
  /** ISO timestamp of the load it comes from. */
  savedAt: string;
  snapshot: FinanceSnapshot;
}

/** Keeps the data just loaded (no-op on the website). A failure only loses the offline copy. */
export async function saveOfflineSnapshot(entry: OfflineSnapshot): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await SecureStoragePlugin.set({ key: KEY, value: JSON.stringify(entry) });
  } catch {
    // Not fatal: the app works online without it.
  }
}

/**
 * The saved copy, or null (website, nothing saved, unreadable, or another user's when `userId` is
 * given: a shared phone never shows someone else's data).
 */
export async function readOfflineSnapshot(userId?: string): Promise<OfflineSnapshot | null> {
  if (!isNativeApp()) return null;
  try {
    const entry = JSON.parse((await SecureStoragePlugin.get({ key: KEY })).value) as OfflineSnapshot;
    if (typeof entry?.userId !== "string" || typeof entry.savedAt !== "string" || !entry.snapshot) return null;
    if (userId !== undefined && entry.userId !== userId) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Forgets the copy (sign-out, account deletion). */
export async function clearOfflineSnapshot(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await SecureStoragePlugin.remove({ key: KEY });
  } catch {
    // Nothing saved.
  }
}
