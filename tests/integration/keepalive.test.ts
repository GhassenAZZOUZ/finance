/** Keep-alive RPC (tech-debt 1d): callable without a session, returns a constant. Requires `supabase start`. */
import { describe, expect, it } from "vitest";
import { anonClient } from "./supabase-env";

describe("keepalive", () => {
  it("answers true to an anonymous caller", async () => {
    const { data, error } = await anonClient().rpc("keepalive");
    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});
