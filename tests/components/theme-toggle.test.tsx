/** ThemeToggle + ThemeSync (issue #11): the choice applies `.dark`, is remembered, and « Système » follows the OS live. */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeSync, ThemeToggle } from "@/components/app/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

let systemDark = false;
const listeners = new Set<() => void>();
beforeEach(() => {
  systemDark = false;
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  window.matchMedia = ((query: string) => ({
    get matches() {
      return systemDark;
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const isDark = () => document.documentElement.classList.contains("dark");

describe("ThemeToggle", () => {
  it("offers three labelled choices, « Système » first and checked by default", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("group", { name: "Thème" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Système", "Clair", "Sombre"]);
    expect((screen.getByRole("radio", { name: "Système" }) as HTMLInputElement).checked).toBe(true);
  });

  it("« Sombre » applies and remembers the dark theme; « Système » follows the OS again, live", async () => {
    render(
      <>
        <ThemeSync />
        <ThemeToggle />
      </>,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Sombre" }));
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await userEvent.click(screen.getByRole("radio", { name: "Système" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(isDark()).toBe(false);
    systemDark = true;
    act(() => listeners.forEach((l) => l()));
    expect(isDark()).toBe(true);
  });
});
