import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NATIVE_CONFIRM_URL, isNativeApp, secureAuthStorage } from "@/lib/native/platform";
import { supabaseEnv } from "./env";

let client: SupabaseClient | undefined;

/**
 * The browser's Supabase client (static app: there is no server). Only the publishable key is
 * used; every row is protected by RLS. PKCE magic links: the session is completed explicitly on
 * /auth/confirm, so automatic URL detection is off. In the Android app (#84) the session is kept in
 * the Keystore rather than the WebView's local storage.
 */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const { url, publishableKey } = supabaseEnv();
    client = createClient(url, publishableKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        ...(isNativeApp() ? { storage: secureAuthStorage } : {}),
      },
    });
  }
  return client;
}

/** App base path on GitHub Pages ("" locally). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Absolute URL of the magic-link landing page for the current site; in the Android app, the app itself. */
export function authConfirmUrl(): string {
  if (isNativeApp()) return NATIVE_CONFIRM_URL;
  return `${window.location.origin}${BASE_PATH}/auth/confirm/`;
}
