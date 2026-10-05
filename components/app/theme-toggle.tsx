"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useId, useSyncExternalStore } from "react";
import {
  DARK_QUERY,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  applyTheme,
  readThemeChoice,
  resolveTheme,
  writeThemeChoice,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const CHANGE_EVENT = "finance-theme-change";
/** The choice made in this tab, so it holds for the session even when storage is blocked. */
let sessionChoice: ThemeChoice | null = null;

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) {
      sessionChoice = null;
      onChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Current choice; null while hydrating (the server cannot know it). */
function useThemeChoice(): ThemeChoice | null {
  return useSyncExternalStore(subscribe, () => sessionChoice ?? readThemeChoice(), () => null);
}

export function setThemeChoice(choice: ThemeChoice): void {
  sessionChoice = choice;
  writeThemeChoice(choice);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Keeps the `.dark` class in line with the choice and, on "Système", with the OS setting while
 * the app is open. Mounted once in the root layout; the first paint is set by THEME_INIT_SCRIPT.
 */
export function ThemeSync() {
  const choice = useThemeChoice();
  useEffect(() => {
    if (choice === null) return;
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => applyTheme(resolveTheme(choice, media.matches));
    apply();
    if (choice !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice]);
  return null;
}

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Système", icon: Monitor },
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
];

/**
 * Système / Clair / Sombre (issue #11): native radio buttons (keyboard and screen readers get
 * the current choice for free), styled as a segmented control.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const choice = useThemeChoice();
  // One radio group per toggle (the sidebar and the mobile menu both render one).
  const name = useId();
  return (
    <fieldset className={cn("flex flex-col", className)}>
      <legend className="mb-1.5 px-1 text-[13px] text-muted-foreground">Thème</legend>
      <div className="grid grid-cols-3 gap-0.5 rounded-[10px] border border-input bg-card p-0.5">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-10 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg px-1 text-xs font-medium",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
              choice === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={choice === value}
              onChange={() => setThemeChoice(value)}
              className="sr-only"
            />
            <Icon aria-hidden className="size-3.5 shrink-0" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Same choices, worded and ordered as on the mobile « Plus » page (issue #108). */
const COMPACT_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "system", label: "Auto" },
];

/** Clair / Sombre / Auto segmented control for a settings row; the row's label names it. */
export function CompactThemeToggle({ labelledBy }: { labelledBy: string }) {
  const choice = useThemeChoice();
  const name = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="inline-grid shrink-0 grid-cols-3 rounded-[10px] bg-accent/60 p-[3px] text-[13px]">
      {COMPACT_OPTIONS.map(({ value, label }) => (
        <label
          key={value}
          className={cn(
            "flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2.5",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
            choice === value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={choice === value}
            onChange={() => setThemeChoice(value)}
            className="sr-only"
          />
          {label}
        </label>
      ))}
    </div>
  );
}
