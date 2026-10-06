/** Offline read-only view of the Android app (issue #84, AC-07). Invented data only. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceGate, FinanceProvider, useFinance } from "@/components/app/finance-provider";
import { clearOfflineSnapshot, readOfflineSnapshot, saveOfflineSnapshot } from "@/lib/native/offline-cache";
import { makeSettings, makeSnapshot } from "./helpers";

type AuthHandler = (event: string) => void;
const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    native: true,
    store: new Map<string, string>(),
    session: { user: { id: "user-1", email: "someone@example.com" } } as { user: { id: string; email: string } } | null,
    load: vi.fn(),
    offline: vi.fn(),
    authHandler: null as AuthHandler | null,
    replace,
    router: { replace },
  };
});
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("capacitor-secure-storage-plugin", () => ({
  SecureStoragePlugin: {
    get: async ({ key }: { key: string }) => {
      if (!mocks.store.has(key)) throw new Error("missing");
      return { value: mocks.store.get(key)! };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      mocks.store.set(key, value);
      return { value: true };
    },
    remove: async ({ key }: { key: string }) => ({ value: mocks.store.delete(key) }),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: mocks.session } }),
      onAuthStateChange: (handler: AuthHandler) => {
        mocks.authHandler = handler;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => ({ load: mocks.load }),
  onDataChanged: () => () => {},
  setOfflineMode: mocks.offline,
}));
vi.mock("@/lib/errors", async (original) => ({ ...(await original<typeof import("@/lib/errors")>()), reportError: vi.fn() }));

const SNAPSHOT = makeSnapshot({ settings: makeSettings({ startMonth: "2026-07" }) });

function Page() {
  const { snapshot, offlineSince } = useFinance();
  return (
    <p>
      Plan depuis {snapshot.settings?.startMonth} {offlineSince ? "(copie)" : "(en ligne)"}
    </p>
  );
}

const renderApp = () =>
  render(
    <FinanceProvider>
      <FinanceGate>
        <Page />
      </FinanceGate>
    </FinanceProvider>,
  );

beforeEach(() => {
  mocks.store.clear();
  mocks.native = true;
  mocks.session = { user: { id: "user-1", email: "someone@example.com" } };
  mocks.load.mockReset();
  mocks.offline.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(cleanup);

describe("offline copy (AC-07)", () => {
  it("keeps the data just loaded on the phone", async () => {
    mocks.load.mockResolvedValue(SNAPSHOT);
    renderApp();
    expect(await screen.findByText("Plan depuis 2026-07 (en ligne)")).toBeTruthy();
    await waitFor(async () => expect((await readOfflineSnapshot("user-1"))?.snapshot.settings?.startMonth).toBe("2026-07"));
    expect(mocks.offline).toHaveBeenCalledWith(false);
  });

  it("shows the copy, read-only, when the data cannot be loaded; « Réessayer » reloads", async () => {
    await saveOfflineSnapshot({ userId: "user-1", email: "someone@example.com", savedAt: "2026-10-06T08:30:00.000Z", snapshot: SNAPSHOT });
    mocks.load.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(SNAPSHOT);
    renderApp();
    expect(await screen.findByText("Plan depuis 2026-07 (copie)")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Hors ligne : vos données du 06\/10\/2026 à \d\d:30, en lecture seule\./);
    expect(mocks.offline).toHaveBeenLastCalledWith(true);

    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Plan depuis 2026-07 (en ligne)")).toBeTruthy();
    expect(screen.queryByText(/Hors ligne/)).toBeNull();
  });

  it("shows the copy without network even when the session cannot be refreshed", async () => {
    await saveOfflineSnapshot({ userId: "user-1", email: null, savedAt: "2026-10-06T08:30:00.000Z", snapshot: SNAPSHOT });
    mocks.session = null;
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    renderApp();
    expect(await screen.findByText("Plan depuis 2026-07 (copie)")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("never shows another user's copy", async () => {
    await saveOfflineSnapshot({ userId: "someone-else", email: null, savedAt: "2026-10-06T08:30:00.000Z", snapshot: SNAPSHOT });
    mocks.load.mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp();
    expect((await screen.findByRole("alert")).textContent).toContain("Connexion impossible");
    expect(screen.queryByText(/Plan depuis/)).toBeNull();
  });

  it("is forgotten on sign-out", async () => {
    mocks.load.mockResolvedValue(SNAPSHOT);
    renderApp();
    await waitFor(async () => expect(await readOfflineSnapshot()).not.toBeNull());
    mocks.authHandler!("SIGNED_OUT");
    await waitFor(async () => expect(await readOfflineSnapshot()).toBeNull());
    expect(mocks.replace).toHaveBeenCalledWith("/login/");
  });

  it("keeps nothing on the website", async () => {
    mocks.native = false;
    await saveOfflineSnapshot({ userId: "user-1", email: null, savedAt: "2026-10-06T08:30:00.000Z", snapshot: SNAPSHOT });
    expect(mocks.store.size).toBe(0);
    expect(await readOfflineSnapshot()).toBeNull();
    await clearOfflineSnapshot();
  });
});
