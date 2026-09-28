/**
 * Light / dark theme (issue #11). Default: the system setting. A manual choice (Clair / Sombre)
 * overrides it and is remembered on the device under STORAGE_KEY; "Système" forgets it.
 */
export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "finance-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Anything but a known choice (missing, corrupt, tampered) means "system". */
export function parseThemeChoice(raw: unknown): ThemeChoice {
  return THEME_CHOICES.includes(raw as ThemeChoice) ? (raw as ThemeChoice) : "system";
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice === "system") return systemDark ? "dark" : "light";
  return choice;
}

/** Stored choice; "system" when storage is unavailable (private mode, blocked). */
export function readThemeChoice(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): ThemeChoice {
  try {
    return parseThemeChoice(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Remembers the choice when storage works; the theme still changes for the session otherwise. */
export function writeThemeChoice(choice: ThemeChoice, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage): void {
  try {
    if (choice === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: nothing to remember.
  }
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle("dark", theme === "dark");
}

/**
 * Runs in <head> before the first paint (no flash of the wrong theme). Same rules as above,
 * inlined because it runs before any bundle loads.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var c=null;try{c=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(c!=="light"&&c!=="dark"){c=window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light"}if(c==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`;
