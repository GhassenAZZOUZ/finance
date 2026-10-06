/**
 * Biometric lock of the Android app (issue #84, AC-08): after a time in the background (and at
 * start), the app hides its pages until the fingerprint or face is checked. A per-phone setting,
 * kept in the WebView's storage (it is a preference, not a secret). A convenience lock: the data's
 * protection is the Keystore encryption and the session, not this screen.
 */

export interface LockSettings {
  enabled: boolean;
  /** Time in the background before the lock, in minutes; 0 = as soon as the app is left. */
  idleMinutes: number;
}

export const DEFAULT_LOCK: LockSettings = { enabled: true, idleMinutes: 5 };

/** The choices offered in « Plus → Préférences ». */
export const IDLE_CHOICES = [0, 1, 5, 15] as const;

const KEY = "boussole.lock";

export function readLockSettings(): LockSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<LockSettings> | null;
    if (!raw || typeof raw.enabled !== "boolean" || !IDLE_CHOICES.includes(raw.idleMinutes as (typeof IDLE_CHOICES)[number])) {
      return DEFAULT_LOCK;
    }
    return { enabled: raw.enabled, idleMinutes: raw.idleMinutes! };
  } catch {
    return DEFAULT_LOCK;
  }
}

export function writeLockSettings(settings: LockSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the default applies next time.
  }
}

/** True when coming back after at least the chosen time in the background. */
export function shouldLock(settings: LockSettings, backgroundSince: number | null, now: number): boolean {
  return settings.enabled && backgroundSince !== null && now - backgroundSince >= settings.idleMinutes * 60_000;
}

/** « Immédiatement », « Après 5 min ». */
export function idleLabel(minutes: number): string {
  return minutes === 0 ? "Immédiatement" : `Après ${minutes} min`;
}
