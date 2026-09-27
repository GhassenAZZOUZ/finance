/**
 * Connection details of the LOCAL Supabase stack for integration tests.
 * From env vars (CI) or, locally, from `supabase status -o json`.
 * The secret key is only ever used here, server-side, to create/delete test users.
 */
import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export interface LocalSupabase {
  url: string;
  publishableKey: string;
  secretKey: string;
}

let cached: LocalSupabase | undefined;

export function localSupabase(): LocalSupabase {
  if (cached) return cached;
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY) {
    cached = { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, secretKey: SUPABASE_SECRET_KEY };
  } else {
    const out = execSync("supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as Record<string, string>;
    cached = { url: json.API_URL!, publishableKey: json.PUBLISHABLE_KEY!, secretKey: json.SECRET_KEY! };
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(cached.url)) {
    throw new Error(`Integration tests only run against a local Supabase, got ${cached.url}`);
  }
  return cached;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export function adminClient(): SupabaseClient {
  const env = localSupabase();
  return createClient(env.url, env.secretKey, noSession);
}

export function anonClient(): SupabaseClient {
  const env = localSupabase();
  return createClient(env.url, env.publishableKey, noSession);
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Creates a confirmed user and returns a client signed in as that user (fake data only). */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `test-${label}-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, email, client };
}

export async function deleteTestUser(user: TestUser | undefined): Promise<void> {
  if (user) await adminClient().auth.admin.deleteUser(user.id);
}
