/** Theme resolution (issue #11): system default, manual override, corrupt or blocked storage. */
import { describe, expect, it, vi } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  parseThemeChoice,
  readThemeChoice,
  resolveTheme,
  writeThemeChoice,
} from "@/lib/theme";

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
    data,
  };
};
const blocked = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  removeItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
};

describe("resolveTheme", () => {
  it("follows the system by default", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("a manual choice overrides the system", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("parseThemeChoice", () => {
  it.each([null, undefined, "", "blue", "dark; x", "DARK", 42])("%j → system", (raw) => {
    expect(parseThemeChoice(raw)).toBe("system");
  });
  it("keeps valid choices", () => expect(parseThemeChoice("light")).toBe("light"));
});

describe("storage", () => {
  it("remembers a manual choice and forgets it on « Système »", () => {
    const s = memory();
    writeThemeChoice("dark", s);
    expect(s.data.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemeChoice(s)).toBe("dark");
    writeThemeChoice("system", s);
    expect(s.data.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readThemeChoice(s)).toBe("system");
  });
  it("reads a corrupt value as system", () => expect(readThemeChoice(memory({ [THEME_STORAGE_KEY]: "blue" }))).toBe("system"));
  it("never throws when storage is blocked", () => {
    expect(readThemeChoice(blocked)).toBe("system");
    expect(() => writeThemeChoice("dark", blocked)).not.toThrow();
    expect(readThemeChoice(undefined)).toBe("system");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  function run(stored: string | null, systemDark: boolean, storageThrows = false) {
    const classes = new Set<string>();
    const window = { matchMedia: () => ({ matches: systemDark }) };
    const localStorage = {
      getItem: () => {
        if (storageThrows) throw new Error("blocked");
        return stored;
      },
    };
    const document = { documentElement: { classList: { add: (c: string) => classes.add(c) } } };
    new Function("window", "localStorage", "document", THEME_INIT_SCRIPT)(window, localStorage, document);
    return classes.has("dark");
  }
  it("applies the same rules before the first paint", () => {
    expect(run(null, true)).toBe(true);
    expect(run(null, false)).toBe(false);
    expect(run("dark", false)).toBe(true);
    expect(run("light", true)).toBe(false);
    expect(run("blue", true)).toBe(true);
    expect(run(null, true, true)).toBe(true);
  });
});
