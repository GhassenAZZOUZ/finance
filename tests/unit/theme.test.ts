/** Theme resolution (issue #11): system default, manual override, corrupt or blocked storage. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("AC-05 — contrast ≥ 4.5:1 in both themes", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const tokens = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    const body = css.slice(start, css.indexOf("\n}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  // Text colours on the surfaces they are used on.
  const PAIRS = [
    ["foreground", "background"],
    ["foreground", "card"],
    ["muted-foreground", "card"],
    ["muted-foreground", "background"],
    ["primary-foreground", "primary"],
    ["bucket-moving-ink", "bucket-moving-tint"],
    ["bucket-moving-ink", "card"],
    ["bucket-emergency-ink", "bucket-emergency-tint"],
    ["bucket-emergency-ink", "card"],
    ["bucket-debts-ink", "bucket-debts-tint"],
    ["bucket-debts-ink", "card"],
    ["bucket-remainder-ink", "card"],
    ["good", "good-bg"],
    ["warning", "warning-bg"],
    ["bad", "bad-bg"],
    ["good", "card"],
    ["bad", "card"],
  ] as const;
  const light = tokens(":root");
  const dark = { ...light, ...tokens(".dark") };

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s theme", (_, theme) => {
    for (const [text, surface] of PAIRS) {
      expect(theme[text], text).toBeDefined();
      expect(theme[surface], surface).toBeDefined();
      expect(contrast(theme[text]!, theme[surface]!), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
