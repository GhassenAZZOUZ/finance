/** Loading the user's data (issue #4, AC-08): a failure shows a French error and a retry, never an empty page. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceGate, FinanceProvider, useFinance } from "@/components/app/finance-provider";
import { makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  // A stable router, like Next.js: a new object per render would reload in a loop.
  return { load: vi.fn(), replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
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
}));
vi.mock("@/lib/errors", async (original) => ({ ...(await original<typeof import("@/lib/errors")>()), reportError: vi.fn() }));

function Page() {
  const { email } = useFinance();
  return <p>Tableau de bord de {email}</p>;
}

beforeEach(() => mocks.load.mockReset());
afterEach(cleanup);

describe("FinanceGate", () => {
  it("AC-08 (#4) — shows a French error instead of the page when loading fails, and retries", async () => {
    mocks.load.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(makeSnapshot());
    render(
      <FinanceProvider>
        <FinanceGate>
          <Page />
        </FinanceGate>
      </FinanceProvider>,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Impossible de charger vos données. Vérifiez votre connexion.");
    expect(screen.queryByText(/Tableau de bord/)).toBeNull();

    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Tableau de bord de someone@example.com")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
});
