"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Magic-link landing: exchanges the PKCE code (or verifies a token hash) in the browser. */
export function ConfirmLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // a code can only be exchanged once (React dev double effects)
    started.current = true;
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;
    const auth = supabaseBrowser().auth;
    const attempt = code
      ? auth.exchangeCodeForSession(code)
      : tokenHash && type
        ? auth.verifyOtp({ token_hash: tokenHash, type })
        : Promise.resolve({ error: new Error("missing code") });
    void attempt.then(({ error }) => router.replace(error ? "/login/?error=lien" : "/"));
  }, [params, router]);

  return (
    <p role="status" className="text-center text-sm text-muted-foreground">
      Connexion en cours…
    </p>
  );
}
