/** Read-only repository while the Android app shows its offline copy (issue #84, AC-07). */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({}) }));

const { getRepository, isOfflineMode, setOfflineMode } = await import("@/lib/data/client-store");
const { errorMessage } = await import("@/lib/errors");

afterEach(() => setOfflineMode(false));

describe("offline mode", () => {
  it("refuses every write with a French message, but still loads", async () => {
    setOfflineMode(true);
    expect(isOfflineMode()).toBe(true);
    const repo = getRepository();
    expect(typeof repo.load).toBe("function");
    const refused = await repo.saveBudget({} as never, []).catch((error: unknown) => error);
    expect(errorMessage(refused, "fallback")).toBe("Hors ligne : reconnectez-vous à Internet pour modifier vos données.");
    await expect(repo.saveActual({} as never)).rejects.toMatchObject({ code: "offline" });
    await expect(repo.deleteAccount()).rejects.toMatchObject({ code: "offline" });
  });

  it("is off by default", () => {
    expect(isOfflineMode()).toBe(false);
  });
});
