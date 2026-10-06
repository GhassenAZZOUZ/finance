/** Biometric lock of the Android app (issue #84, AC-08). */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLock, LockSetting } from "@/components/app/app-lock";

type Handler = () => void;
const mocks = vi.hoisted(() => ({
  native: true,
  available: true,
  verify: vi.fn(),
  handlers: new Map<string, () => void>(),
  signOut: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (name: string, handler: Handler) => {
      mocks.handlers.set(name, handler);
      return { remove: () => {} };
    }),
  },
}));
vi.mock("@capgo/capacitor-native-biometric", () => ({
  NativeBiometric: { isAvailable: async () => ({ isAvailable: mocks.available }), verifyIdentity: mocks.verify },
}));
vi.mock("@/components/app/sign-out-button", () => ({ useSignOut: () => mocks.signOut }));

const renderLock = () =>
  render(
    <AppLock>
      <button type="button">Saisir</button>
    </AppLock>,
  );
const lockScreen = () => screen.queryByRole("dialog", { name: "Boussole est verrouillée" });

beforeEach(() => {
  mocks.native = true;
  mocks.available = true;
  mocks.handlers.clear();
  mocks.verify.mockReset().mockResolvedValue(undefined);
  mocks.signOut.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("AppLock", () => {
  it("locks at start, asks for the fingerprint, then shows the app", async () => {
    mocks.verify.mockImplementation(() => new Promise(() => {}));
    renderLock();
    expect(lockScreen()).toBeTruthy();
    // The pages behind cannot be reached.
    expect(screen.getByText("Saisir").closest("[inert]")).toBeTruthy();
    await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce());
    expect(mocks.verify.mock.calls[0]![0]).toMatchObject({ title: "Déverrouiller Boussole", negativeButtonText: "Annuler" });
  });

  it("opens once the fingerprint is recognised", async () => {
    renderLock();
    await waitFor(() => expect(lockScreen()).toBeNull());
    expect(screen.getByText("Saisir").closest("[inert]")).toBeNull();
  });

  it("stays locked when not recognised; « Déverrouiller » asks again; « Se déconnecter » signs out", async () => {
    mocks.verify.mockRejectedValueOnce(new Error("cancelled")).mockResolvedValueOnce(undefined);
    renderLock();
    expect(await screen.findByRole("alert")).toBeTruthy();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Déverrouiller" }));
    await waitFor(() => expect(lockScreen()).toBeNull());
  });

  it("locks again when coming back after the chosen time in the background", async () => {
    window.localStorage.setItem("boussole.lock", JSON.stringify({ enabled: true, idleMinutes: 1 }));
    renderLock();
    await waitFor(() => expect(lockScreen()).toBeNull());
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    act(() => mocks.handlers.get("pause")!());
    now.mockReturnValue(1_000_000 + 30_000);
    act(() => mocks.handlers.get("resume")!());
    expect(lockScreen()).toBeNull();

    now.mockReturnValue(2_000_000);
    act(() => mocks.handlers.get("pause")!());
    mocks.verify.mockImplementation(() => new Promise(() => {}));
    now.mockReturnValue(2_000_000 + 60_000);
    act(() => mocks.handlers.get("resume")!());
    expect(lockScreen()).toBeTruthy();
    now.mockRestore();
  });

  it("does not lock when turned off, on a phone without biometrics, or on the website", async () => {
    window.localStorage.setItem("boussole.lock", JSON.stringify({ enabled: false, idleMinutes: 5 }));
    renderLock();
    expect(lockScreen()).toBeNull();
    cleanup();

    window.localStorage.clear();
    mocks.available = false;
    renderLock();
    await waitFor(() => expect(lockScreen()).toBeNull());
    expect(mocks.verify).not.toHaveBeenCalled();
    cleanup();

    mocks.native = false;
    renderLock();
    expect(lockScreen()).toBeNull();
  });
});

describe("LockSetting", () => {
  const renderSetting = () =>
    render(
      <ul>
        <LockSetting />
      </ul>,
    );

  it("chooses the delay or turns the lock off, for this phone", async () => {
    renderSetting();
    const select = (await screen.findByLabelText("Verrouillage par empreinte")) as HTMLSelectElement;
    expect(select.value).toBe("5");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Désactivé", "Immédiatement", "Après 1 min", "Après 5 min", "Après 15 min"]);
    const user = userEvent.setup({ delay: null });
    await user.selectOptions(select, "Désactivé");
    expect(JSON.parse(window.localStorage.getItem("boussole.lock")!)).toEqual({ enabled: false, idleMinutes: 5 });
    await user.selectOptions(select, "Immédiatement");
    expect(JSON.parse(window.localStorage.getItem("boussole.lock")!)).toEqual({ enabled: true, idleMinutes: 0 });
  });

  it("is hidden without biometrics and on the website", async () => {
    mocks.available = false;
    renderSetting();
    await waitFor(() => expect(screen.queryByLabelText("Verrouillage par empreinte")).toBeNull());
    cleanup();
    mocks.native = false;
    renderSetting();
    expect(screen.queryByLabelText("Verrouillage par empreinte")).toBeNull();
  });
});
