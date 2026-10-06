"use client";

import { App } from "@capacitor/app";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import { Fingerprint, LockKeyhole } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useSignOut } from "@/components/app/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  IDLE_CHOICES,
  type LockSettings,
  idleLabel,
  readLockSettings,
  shouldLock,
  writeLockSettings,
} from "@/lib/native/app-lock";
import { isNativeApp } from "@/lib/native/platform";

/** Whether this phone can check a fingerprint or a face; null while asking, false on the website. */
export function useBiometricAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(() => (isNativeApp() ? null : false));
  useEffect(() => {
    if (!isNativeApp()) return;
    let live = true;
    NativeBiometric.isAvailable()
      .then((r) => live && setAvailable(r.isAvailable))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);
  return available;
}

/**
 * Biometric lock of the Android app (issue #84, AC-08): at start, and when coming back after the
 * chosen time in the background, the pages are hidden (inert) behind a lock screen until the
 * fingerprint or face is checked. Nothing on the website, nor on a phone without biometrics.
 */
export function AppLock({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<boolean | null>(() => (isNativeApp() ? null : false));
  const [locked, setLocked] = useState(() => isNativeApp() && readLockSettings().enabled);
  const [failed, setFailed] = useState(false);
  const lockedAtStart = useRef(locked);
  const backgroundSince = useRef<number | null>(null);
  // The system prompt itself can pause and resume the app: never re-lock because of it.
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      await NativeBiometric.verifyIdentity({
        title: "Déverrouiller Boussole",
        subtitle: "Empreinte ou visage",
        reason: "Déverrouiller Boussole",
        negativeButtonText: "Annuler",
        maxAttempts: 5,
      });
      setFailed(false);
      setLocked(false);
    } catch {
      setFailed(true);
    } finally {
      prompting.current = false;
    }
  }, []);

  // No biometrics on this phone: nothing to unlock with, so no lock.
  const active = locked && available !== false;

  useEffect(() => {
    if (!isNativeApp()) return;
    let live = true;
    // At start: ask straight away once the phone says it can check a fingerprint or a face.
    NativeBiometric.isAvailable()
      .then((r) => {
        if (!live) return;
        setAvailable(r.isAvailable);
        if (r.isAvailable && lockedAtStart.current) void unlock();
      })
      .catch(() => live && setAvailable(false));
    const listeners = [
      App.addListener("pause", () => {
        if (!prompting.current) backgroundSince.current = Date.now();
      }),
      App.addListener("resume", () => {
        if (prompting.current) return;
        if (shouldLock(readLockSettings(), backgroundSince.current, Date.now())) {
          setLocked(true);
          void unlock();
        }
        backgroundSince.current = null;
      }),
    ];
    return () => {
      live = false;
      for (const listener of listeners) void listener.then((l) => l.remove());
    };
  }, [unlock]);

  return (
    <>
      {active ? <LockScreen checking={available === null} failed={failed} onUnlock={() => void unlock()} /> : null}
      <div className="contents" inert={active || undefined}>
        {children}
      </div>
    </>
  );
}

function LockScreen({ checking, failed, onUnlock }: { checking: boolean; failed: boolean; onUnlock: () => void }) {
  const titleId = useId();
  const signOut = useSignOut();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-background px-6 text-center"
    >
      <LockKeyhole aria-hidden className="size-10 text-muted-foreground" />
      <h1 id={titleId} className="font-heading text-[28px] font-medium">
        Boussole est verrouillée
      </h1>
      {failed ? <p role="alert" className="text-sm text-bad">Empreinte ou visage non reconnu. Réessayez.</p> : null}
      <Button type="button" className="min-h-12 px-6 text-[15px]" onClick={onUnlock} disabled={checking}>
        <Fingerprint aria-hidden />
        Déverrouiller
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 text-destructive" onClick={() => void signOut()}>
        Se déconnecter
      </Button>
    </div>
  );
}

/** « Plus → Préférences »: the lock's setting, only in the app on a phone with biometrics. */
export function LockSetting({ className }: { className?: string }) {
  const available = useBiometricAvailable();
  const [settings, setSettings] = useState<LockSettings>(() => readLockSettings());
  const id = useId();
  if (!available) return null;
  const value = settings.enabled ? String(settings.idleMinutes) : "off";
  return (
    <li className={className}>
      <span aria-hidden className="flex size-8.5 shrink-0 items-center justify-center rounded-[10px] bg-muted">
        <Fingerprint className="size-4.5" />
      </span>
      <label htmlFor={id} className="grow">
        Verrouillage par empreinte
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const next = e.target.value === "off" ? { ...settings, enabled: false } : { enabled: true, idleMinutes: Number(e.target.value) };
          setSettings(next);
          writeLockSettings(next);
        }}
        className="h-10 rounded-[10px] border border-input bg-card px-2 text-sm"
      >
        <option value="off">Désactivé</option>
        {IDLE_CHOICES.map((m) => (
          <option key={m} value={m}>
            {idleLabel(m)}
          </option>
        ))}
      </select>
    </li>
  );
}
