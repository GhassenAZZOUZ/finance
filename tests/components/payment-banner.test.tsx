/** Failed-payment banner (issue #144, US-7). Invented data only. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceGate, FinanceProvider } from "@/components/app/finance-provider";
import { PaymentBanner } from "@/components/app/payment-banner";
import { makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return { load: vi.fn(), replace, router: { replace }, native: false };
});
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/native/platform", async (original) => ({ ...(await original<typeof import("@/lib/native/platform")>()), isNativeApp: () => mocks.native }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { email: "someone@example.com" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => ({ load: mocks.load }),
  onDataChanged: () => () => {},
  setOfflineMode: () => {},
}));

beforeEach(() => {
  mocks.load.mockReset();
  mocks.native = false;
});
afterEach(cleanup);

const GRACE = { kind: "grace" as const, graceEndsAt: "2027-02-22T10:00:00Z", paymentUrl: "https://invoice.stripe.com/i/x" };

describe("PaymentBanner", () => {
  it("during the grace period: Pro until the date, a link to Stripe's payment page", () => {
    render(<PaymentBanner problem={GRACE} />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Paiement échoué.");
    expect(banner.textContent).toContain("Pro reste actif jusqu’au 22 février 2027 : réglez le paiement d’ici là.");
    expect(screen.getByRole("link", { name: "Régler le paiement" }).getAttribute("href")).toBe("https://invoice.stripe.com/i/x");
  });

  it("once lapsed: back to Free, data kept; without a payment page, the Pro offer", () => {
    render(<PaymentBanner problem={{ kind: "lapsed", graceEndsAt: null, paymentUrl: null }} />);
    expect(screen.getByRole("status").textContent).toContain("votre compte est repassé en Free. Vos données sont conservées.");
    expect(screen.getByRole("link", { name: "Voir l’offre Pro" }).getAttribute("href")).toBe("/abonnement");
  });

  it("in the Android app: no payment link, pay from the website", () => {
    mocks.native = true;
    render(<PaymentBanner problem={GRACE} />);
    expect(screen.getByRole("status").textContent).toContain("Réglez-le depuis le site Boussole.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is shown above every page while there is a problem, and not otherwise", async () => {
    mocks.load.mockResolvedValueOnce({ ...makeSnapshot(), paymentProblem: GRACE });
    render(
      <FinanceProvider>
        <FinanceGate>
          <p>Page</p>
        </FinanceGate>
      </FinanceProvider>,
    );
    expect(await screen.findByText("Page")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Régler le paiement" })).toBeTruthy();
    cleanup();
    mocks.load.mockResolvedValueOnce(makeSnapshot());
    render(
      <FinanceProvider>
        <FinanceGate>
          <p>Page</p>
        </FinanceGate>
      </FinanceProvider>,
    );
    expect(await screen.findByText("Page")).toBeTruthy();
    expect(screen.queryByText(/Paiement échoué/)).toBeNull();
  });
});
