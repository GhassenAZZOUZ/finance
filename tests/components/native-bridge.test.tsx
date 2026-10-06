/** Android app shell (issue #84): the magic link and the back button inside the app. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeBridge } from "@/components/app/native-bridge";

type Handler = (event: Record<string, unknown>) => void;
const mocks = vi.hoisted(() => ({
  native: false,
  handlers: new Map<string, (event: Record<string, unknown>) => void>(),
  remove: vi.fn(),
  exitApp: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (name: string, handler: Handler) => {
      mocks.handlers.set(name, handler);
      return { remove: mocks.remove };
    }),
    exitApp: mocks.exitApp,
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

beforeEach(() => {
  mocks.handlers.clear();
  mocks.native = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("NativeBridge", () => {
  it("does nothing on the website", () => {
    render(<NativeBridge />);
    expect(mocks.handlers.size).toBe(0);
  });

  it("AC-02 — a magic link opening the app lands on its sign-in page; other links are ignored", () => {
    mocks.native = true;
    render(<NativeBridge />);
    mocks.handlers.get("appUrlOpen")!({ url: "io.github.ghassenazzouz.boussole://auth/confirm/?code=abc" });
    expect(mocks.replace).toHaveBeenCalledWith("/auth/confirm/?code=abc");
    mocks.handlers.get("appUrlOpen")!({ url: "io.github.ghassenazzouz.boussole://plus/" });
    expect(mocks.replace).toHaveBeenCalledOnce();
  });

  it("the back button goes back a page, and leaves the app from the first one", () => {
    mocks.native = true;
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(<NativeBridge />);
    mocks.handlers.get("backButton")!({ canGoBack: true });
    expect(back).toHaveBeenCalledOnce();
    mocks.handlers.get("backButton")!({ canGoBack: false });
    expect(mocks.exitApp).toHaveBeenCalledOnce();
  });

  it("removes its listeners when unmounted", async () => {
    mocks.native = true;
    const { unmount } = render(<NativeBridge />);
    unmount();
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
  });
});
