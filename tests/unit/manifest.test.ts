/** Web app manifest (issue #6): standalone, start URL and icons under the base path. */
import { describe, expect, it, vi } from "vitest";

async function load(basePath: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
  const { default: manifest } = await import("@/app/manifest");
  vi.unstubAllEnvs();
  return manifest();
}

// The first dynamic import of the app module can take a few seconds on a busy machine.
describe("manifest", { timeout: 20_000 }, () => {
  it("opens standalone at the app root, with 192/512 and maskable icons", async () => {
    const m = await load("");
    expect(m).toMatchObject({ name: "Cap", display: "standalone", start_url: "/", scope: "/" });
    expect(m.icons?.map((i) => [i.sizes, i.purpose])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
  });

  it("prefixes every URL with the GitHub Pages base path", async () => {
    const m = await load("/finance");
    expect(m.start_url).toBe("/finance/");
    expect(m.scope).toBe("/finance/");
    expect(m.icons?.every((i) => i.src.startsWith("/finance/icons/"))).toBe(true);
    expect(m.shortcuts?.[0]?.url).toBe("/finance/suivi/");
  });
});
