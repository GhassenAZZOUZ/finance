/** Android app shell (issue #84): links into the app and the session in the Keystore. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("capacitor-secure-storage-plugin", () => ({
  SecureStoragePlugin: {
    get: vi.fn(async ({ key }: { key: string }) => {
      if (!store.has(key)) throw new Error("Item with given key does not exist");
      return { value: store.get(key)! };
    }),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
      return { value: true };
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      if (!store.delete(key)) throw new Error("Item with given key does not exist");
      return { value: true };
    }),
  },
}));

const { APP_SCHEME, NATIVE_CONFIRM_URL, appRouteOf, isNativeApp, secureAuthStorage } = await import("@/lib/native/platform");

beforeEach(() => store.clear());

describe("appRouteOf (AC-02)", () => {
  it("opens the sign-in landing with the link's code", () => {
    expect(appRouteOf(`${APP_SCHEME}://auth/confirm/?code=abc-123`)).toBe("/auth/confirm/?code=abc-123");
    expect(appRouteOf(`${APP_SCHEME}://auth/confirm?token_hash=x&type=magiclink`)).toBe("/auth/confirm/?token_hash=x&type=magiclink");
    expect(appRouteOf(NATIVE_CONFIRM_URL)).toBe("/auth/confirm/");
  });

  it("ignores other schemes and any other page of the app", () => {
    expect(appRouteOf("https://ghassenazzouz.github.io/finance/auth/confirm/?code=abc")).toBeNull();
    expect(appRouteOf(`${APP_SCHEME}://credits/`)).toBeNull();
    expect(appRouteOf(`${APP_SCHEME}://auth/confirm/../../plus/`)).toBeNull();
    expect(appRouteOf("javascript:alert(1)")).toBeNull();
  });
});

describe("secureAuthStorage (AC-03)", () => {
  it("keeps the session in the secure store; a missing key reads as null", async () => {
    expect(await secureAuthStorage.getItem("sb-session")).toBeNull();
    await secureAuthStorage.setItem("sb-session", '{"access_token":"t"}');
    expect(await secureAuthStorage.getItem("sb-session")).toBe('{"access_token":"t"}');
    await secureAuthStorage.removeItem("sb-session");
    await secureAuthStorage.removeItem("sb-session");
    expect(await secureAuthStorage.getItem("sb-session")).toBeNull();
  });
});

describe("isNativeApp", () => {
  it("is false in a browser", () => {
    expect(isNativeApp()).toBe(false);
  });
});
