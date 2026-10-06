/** Contextual paywall (issue #140, US-3). Invented data only. */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaywallHost } from "@/components/app/paywall";
import { openPaywall } from "@/lib/billing/paywall";

const mocks = vi.hoisted(() => ({ native: false, createCheckout: vi.fn(), assign: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("@/lib/billing/client", async (original) => ({
  ...(await original<typeof import("@/lib/billing/client")>()),
  createCheckout: mocks.createCheckout,
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => {
  mocks.native = false;
  mocks.createCheckout.mockReset();
  mocks.assign.mockReset();
  window.sessionStorage.clear();
  Object.defineProperty(window, "location", { value: { ...window.location, assign: mocks.assign }, configurable: true });
});
afterEach(cleanup);

describe("PaywallHost", () => {
  it("is not shown until a limit is reached, then names it and records paywall_viewed", () => {
    const seen = vi.fn();
    window.addEventListener("boussole:event", seen);
    render(<PaywallHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openPaywall("loans_limit"));
    const dialog = screen.getByRole("dialog", { name: "Suivez tous vos crédits" });
    expect(dialog.textContent).toContain("Le plan gratuit compte 1 crédit");
    expect((seen.mock.calls[0]![0] as CustomEvent).detail).toEqual({ name: "paywall_viewed", reason: "loans_limit" });
    expect(JSON.parse(window.sessionStorage.getItem("boussole.events")!)[0]).toMatchObject({ name: "paywall_viewed", reason: "loans_limit" });
    window.removeEventListener("boussole:event", seen);
  });

  it("goes to Checkout (yearly, with the trial) or shows why it cannot", async () => {
    mocks.createCheckout.mockResolvedValueOnce({ error: "not_configured" }).mockResolvedValueOnce({ url: "https://checkout.stripe.com/c/pay/cs_test" });
    render(<PaywallHost />);
    act(() => openPaywall("goals_limit"));
    const dialog = screen.getByRole("dialog", { name: "Plusieurs objectifs d’épargne" });
    const user = userEvent.setup({ delay: null });
    await user.click(within(dialog).getByRole("button", { name: "Essayer Pro 14 jours gratuitement" }));
    expect(mocks.createCheckout).toHaveBeenCalledWith("yearly");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("pas encore ouvert");
    await user.click(within(dialog).getByRole("button", { name: "Essayer Pro 14 jours gratuitement" }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test"));
    expect(within(dialog).getByRole("link", { name: "Voir les formules" }).getAttribute("href")).toBe("/abonnement");
  });

  it("closes without buying, and offers no purchase in the Android app", async () => {
    render(<PaywallHost />);
    act(() => openPaywall("plan_limit"));
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    mocks.native = true;
    act(() => openPaywall("history_limit"));
    const dialog = screen.getByRole("dialog", { name: "Tout votre historique" });
    expect(dialog.textContent).toContain("n’est pas proposé dans l’application Android");
    expect(within(dialog).queryByRole("button", { name: /Essayer Pro/ })).toBeNull();
  });
});
