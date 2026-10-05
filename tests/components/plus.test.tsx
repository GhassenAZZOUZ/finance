/** « Plus » page (issue #108): account, tools, data, theme, guide and sign-out; desktop goes back to `/`. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlusView } from "@/app/(app)/plus/view";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), start: vi.fn(), signOut: vi.fn(async () => {}), desktop: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => ({ email: "demo@example.test" }) }));
vi.mock("@/components/app/tour", () => ({ useTour: () => ({ start: mocks.start }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ auth: { signOut: mocks.signOut } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop = false;
  localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width") ? mocks.desktop : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const href = (name: string) => screen.getByRole("link", { name: new RegExp(name) }).getAttribute("href");

describe("PlusView", () => {
  it("shows the account and links to the tools and the data pages", () => {
    render(<PlusView />);
    expect(screen.getByRole("heading", { level: 1, name: "Plus" })).toBeTruthy();
    expect(screen.getByText("demo@example.test")).toBeTruthy();
    expect(href("Plan mois par mois")).toBe("/plan");
    expect(href("Et si… \\?")).toBe("/simuler");
    expect(href("Historique du suivi")).toBe("/suivi#suivi-history-title");
    expect(href("Exporter")).toBe("/donnees");
    expect(href("Importer le classeur")).toBe("/import");
    expect(href("Rappel mensuel")).toBe("/donnees");
    expect(screen.getByRole("region", { name: "Outils" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Mes données" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Préférences" })).toBeTruthy();
  });

  it("chooses the theme with Clair / Sombre / Auto, Auto by default", async () => {
    render(<PlusView />);
    expect(screen.getByRole("radiogroup", { name: "Thème" })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Auto" }).checked).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Sombre" }));
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Sombre" }).checked).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("replays the guided tour", async () => {
    render(<PlusView />);
    await userEvent.click(screen.getByRole("button", { name: "Revoir la visite guidée" }));
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("signs out to the login page", async () => {
    render(<PlusView />);
    await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.replace).toHaveBeenCalledWith("/login/");
  });

  it("stays on a phone and goes back to the dashboard on a desktop-wide window", () => {
    render(<PlusView />);
    expect(mocks.replace).not.toHaveBeenCalled();
    cleanup();
    mocks.desktop = true;
    render(<PlusView />);
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });
});
