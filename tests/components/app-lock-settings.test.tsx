/** Biometric lock settings of the Android app (issue #84, AC-08). */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCK, idleLabel, readLockSettings, shouldLock, writeLockSettings } from "@/lib/native/app-lock";

afterEach(() => window.localStorage.clear());

describe("lock settings", () => {
  it("defaults to on after 5 minutes, and keeps the phone's choice", () => {
    expect(readLockSettings()).toEqual(DEFAULT_LOCK);
    expect(DEFAULT_LOCK).toEqual({ enabled: true, idleMinutes: 5 });
    writeLockSettings({ enabled: false, idleMinutes: 15 });
    expect(readLockSettings()).toEqual({ enabled: false, idleMinutes: 15 });
  });

  it("falls back to the default on a corrupt or unknown value", () => {
    window.localStorage.setItem("boussole.lock", "{oops");
    expect(readLockSettings()).toEqual(DEFAULT_LOCK);
    window.localStorage.setItem("boussole.lock", JSON.stringify({ enabled: true, idleMinutes: 7 }));
    expect(readLockSettings()).toEqual(DEFAULT_LOCK);
  });

  it("labels the delays in French", () => {
    expect(idleLabel(0)).toBe("Immédiatement");
    expect(idleLabel(5)).toBe("Après 5 min");
  });
});

describe("shouldLock", () => {
  const t0 = 1_000_000;
  it("locks after at least the chosen time in the background", () => {
    expect(shouldLock({ enabled: true, idleMinutes: 5 }, t0, t0 + 5 * 60_000)).toBe(true);
    expect(shouldLock({ enabled: true, idleMinutes: 5 }, t0, t0 + 5 * 60_000 - 1)).toBe(false);
    expect(shouldLock({ enabled: true, idleMinutes: 0 }, t0, t0)).toBe(true);
  });

  it("never locks when off or without a time in the background", () => {
    expect(shouldLock({ enabled: false, idleMinutes: 0 }, t0, t0 + 3_600_000)).toBe(false);
    expect(shouldLock({ enabled: true, idleMinutes: 0 }, null, t0)).toBe(false);
  });
});
