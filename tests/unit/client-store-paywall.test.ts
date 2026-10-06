/** A write refused for a Free limit opens the paywall, then rejects as before (issues #139, #140). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepositoryError } from "@/lib/data/repository";

const mocks = vi.hoisted(() => ({ createLoan: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));
vi.mock("@/lib/data/supabase-repository", () => ({
  SupabaseFinanceRepository: class {
    createLoan = mocks.createLoan;
    load = mocks.load;
  },
}));

const { getRepository } = await import("@/lib/data/client-store");
const { onPaywall } = await import("@/lib/billing/paywall");

afterEach(() => vi.resetAllMocks());

describe("getRepository and the paywall", () => {
  it("opens the paywall on a PT402 refusal and still rejects for the form", async () => {
    const opened = vi.fn();
    const off = onPaywall(opened);
    mocks.createLoan.mockRejectedValue(new RepositoryError("loans_limit", "PT402"));
    await expect(getRepository().createLoan({} as never)).rejects.toMatchObject({ code: "PT402" });
    expect(opened).toHaveBeenCalledWith("loans_limit");
    off();
  });

  it("leaves other errors and successes alone", async () => {
    const opened = vi.fn();
    const off = onPaywall(opened);
    mocks.createLoan.mockRejectedValueOnce(new RepositoryError("boom", "23514")).mockResolvedValueOnce({ id: "loan-1" });
    await expect(getRepository().createLoan({} as never)).rejects.toMatchObject({ code: "23514" });
    await expect(getRepository().createLoan({} as never)).resolves.toEqual({ id: "loan-1" });
    expect(opened).not.toHaveBeenCalled();
    off();
  });
});
