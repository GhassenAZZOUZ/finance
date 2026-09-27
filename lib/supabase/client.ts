import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let client: SupabaseClient | undefined;

/**
 * The browser's Supabase client (static app: there is no server). Only the publishable key is
 * used; every row is protected by RLS. PKCE magic links: the session is completed explicitly on
 * /auth/confirm, so automatic URL detection is off.
 */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const { url, publishableKey } = supabaseEnv();
    client = createClient(url, publishableKey, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

/** App base path on GitHub Pages ("" locally). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Absolute URL of the magic-link landing page for the current site. */
export function authConfirmUrl(): string {
  return `${window.location.origin}${BASE_PATH}/auth/confirm/`;
}
