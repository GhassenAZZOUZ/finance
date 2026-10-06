/** Boussole Pro page and Checkout return (issue #141, US-4). Invented data only. */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionView } from "@/app/(app)/abonnement/subscription-view";
import { CheckoutSuccess, POLL_ATTEMPTS, POLL_MS } from "@/app/(app)/abonnement/succes/checkout-success";
import type { Entitlement } from "@/lib/billing/client";

const mocks = vi.hoisted(() => ({
  native: false,
  fetchEntitlement: vi.fn(),
  createCheckout: vi.fn(),
  assign: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("@/lib/billing/client", async (original) => ({
  ...(await original<typeof import("@/lib/billing/client")>()),
  fetchEntitlement: mocks.fetchEntitlement,
  createCheckout: mocks.createCheckout,
}));
vi.mock("@/lib/errors", async (original) => ({ ...(await original<typeof import("@/lib/errors")>()), reportError: vi.fn() }));

const pro = (over: Partial<Entitlement> = {}): Entitlement => ({
  isPro: true,
  status: "active",
  currentPeriodEnd: "2027-03-15T10:00:00Z",
  cancelAtPeriodEnd: false,
  ...over,
});

beforeEach(() => {
  mocks.native = false;
  mocks.fetchEntitlement.mockReset();
  mocks.createCheckout.mockReset();
  mocks.assign.mockReset();
  Object.defineProperty(window, "location", { value: { ...window.location, assign: mocks.assign }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SubscriptionView", () => {
  it("offers a Free user the two plans with the trial, yearly first, and goes to Checkout", async () => {
    mocks.fetchEntitlement.mockResolvedValue(null);
    mocks.createCheckout.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    render(<SubscriptionView />);
    const yearly = (await screen.findByRole("radio", { name: /Annuel/ })) as HTMLInputElement;
    expect(yearly.checked).toBe(true);
    expect(screen.getByText(/14 jours d’essai gratuit, puis 39 € par an/)).toBeTruthy();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("radio", { name: /Mensuel/ }));
    expect(screen.getByText(/puis 4,99 € par mois/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Essayer 14 jours gratuitement" }));
    expect(mocks.createCheckout).toHaveBeenCalledWith("monthly");
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"));
  });

  it("gives no trial to a former subscriber, and shows Checkout's refusal in French", async () => {
    mocks.fetchEntitlement.mockResolvedValue(pro({ isPro: false, status: "canceled" }));
    mocks.createCheckout.mockResolvedValue({ error: "not_configured" });
    render(<SubscriptionView />);
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole("button", { name: "S’abonner" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Le paiement n’est pas encore ouvert. Réessayez plus tard.");
    expect(screen.queryByText(/jours d’essai/)).toBeNull();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("shows a Pro user their subscription, renewal or end date", async () => {
    mocks.fetchEntitlement.mockResolvedValue(pro());
    render(<SubscriptionView />);
    expect(await screen.findByText("Vous êtes abonné à Boussole Pro.")).toBeTruthy();
    expect(screen.getByText("Prochain renouvellement le 15 mars 2027.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /S’abonner|Essayer/ })).toBeNull();
    cleanup();

    mocks.fetchEntitlement.mockResolvedValue(pro({ status: "trialing", cancelAtPeriodEnd: true }));
    render(<SubscriptionView />);
    expect(await screen.findByText("Vous êtes abonné à Boussole Pro (période d’essai).")).toBeTruthy();
    expect(screen.getByText("Résilié : Pro reste actif jusqu’au 15 mars 2027.")).toBeTruthy();
  });

  it("offers no purchase in the Android app (Google Play billing rules)", async () => {
    mocks.native = true;
    mocks.fetchEntitlement.mockResolvedValue(null);
    render(<SubscriptionView />);
    expect(await screen.findByText(/L’abonnement n’est pas proposé dans l’application Android/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /S’abonner|Essayer/ })).toBeNull();
    expect(screen.queryByText(/4,99 €|39 €/)).toBeNull();
  });
});

describe("CheckoutSuccess", () => {
  it("never grants Pro itself: it waits for the webhook, then confirms", async () => {
    vi.useFakeTimers();
    mocks.fetchEntitlement.mockResolvedValueOnce(null).mockResolvedValueOnce(pro({ status: "trialing" }));
    render(<CheckoutSuccess />);
    expect(screen.getByRole("status").textContent).toBe("Activation de votre abonnement…");
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 10));
    expect(screen.getByText("Bienvenue dans Boussole Pro !")).toBeTruthy();
    expect(mocks.fetchEntitlement).toHaveBeenCalledTimes(2);
  });

  it("says when the activation takes longer, and checks again on demand", async () => {
    vi.useFakeTimers();
    mocks.fetchEntitlement.mockResolvedValue(null);
    render(<CheckoutSuccess />);
    await act(() => vi.advanceTimersByTimeAsync(POLL_ATTEMPTS * POLL_MS + 10));
    expect(screen.getByText(/prend un peu plus de temps que prévu/)).toBeTruthy();
    mocks.fetchEntitlement.mockResolvedValue(pro());
    act(() => screen.getByRole("button", { name: "Vérifier à nouveau" }).click());
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText("Bienvenue dans Boussole Pro !")).toBeTruthy();
  });
});
