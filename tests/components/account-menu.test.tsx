/** Desktop sidebar: the account settings (data, guide, theme, sign-out) sit in a menu closed by default. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/app/nav";
import { TourProvider } from "@/components/app/tour";
import { tourStorageKey } from "@/components/app/tour-logic";

const EMAIL = "someone@example.test";
vi.mock("@/components/app/finance-provider", () => ({ useOptionalFinance: () => ({ email: EMAIL, snapshot: { settings: null } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ auth: { signOut: vi.fn() } }) }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(tourStorageKey(EMAIL), "seen");
});
afterEach(cleanup);

function renderSidebar() {
  render(
    <TourProvider>
      <Sidebar />
    </TourProvider>,
  );
  return userEvent.setup({ delay: null });
}
const accountButton = () => screen.getByRole("button", { name: /Compte/ });

describe("Sidebar account menu", () => {
  it("is closed by default: only the account button with the e-mail shows", () => {
    renderSidebar();
    expect(accountButton().getAttribute("aria-expanded")).toBe("false");
    expect(accountButton().textContent).toContain(EMAIL);
    expect(screen.queryByRole("link", { name: "Mes données" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Thème" })).toBeNull();
  });

  it("opens on click with data, guide, theme and sign-out; Escape closes it and returns focus", async () => {
    const user = renderSidebar();
    await user.click(accountButton());
    expect(accountButton().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Mes données" }).getAttribute("href")).toContain("/donnees");
    expect(screen.getByRole("button", { name: /Guide de l’application/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Thème" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Se déconnecter|Déconnexion/ })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(accountButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(accountButton());
  });

  it("closes on a click outside", async () => {
    const user = renderSidebar();
    await user.click(accountButton());
    await user.click(screen.getByRole("link", { name: /Budget/ }));
    expect(accountButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("carries the tour targets while closed", () => {
    renderSidebar();
    expect(accountButton().getAttribute("data-tour")).toBe("donnees guide");
  });
});
