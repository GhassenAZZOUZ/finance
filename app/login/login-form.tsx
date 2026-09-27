"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authConfirmUrl, supabaseBrowser } from "@/lib/supabase/client";

interface LoginState {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sends a magic link; the link lands on /auth/confirm in this same browser (PKCE). */
async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!EMAIL.test(email)) return { status: "error", message: "Adresse e-mail invalide", email };
  const { error } = await supabaseBrowser().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authConfirmUrl() },
  });
  if (error) return { status: "error", message: "Envoi impossible pour le moment. Réessayez dans un instant.", email };
  return { status: "sent", email };
}

export function LoginForm() {
  const router = useRouter();
  const linkError = useSearchParams().get("error") !== null;
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  // Already signed in: go straight to the app.
  useEffect(() => {
    void supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace("/");
      });
  }, [router]);

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
        <p className="font-medium">Lien envoyé à {state.email}.</p>
        <p className="mt-1">
          Ouvrez l’e-mail et cliquez sur le lien pour vous connecter, <strong>sur cet appareil et dans ce navigateur</strong>.
        </p>
      </div>
    );
  }

  return (
    <>
      {linkError ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Ce lien de connexion est invalide, a expiré, ou a été ouvert dans un autre navigateur que celui où vous
          l’avez demandé. Demandez-en un nouveau.
        </p>
      ) : null}
      <form action={action} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Adresse e-mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            defaultValue={state.email}
            aria-invalid={state.status === "error" || undefined}
            aria-describedby={state.status === "error" ? "email-error" : undefined}
          />
          {state.status === "error" ? (
            <p id="email-error" className="text-sm text-red-700">
              {state.message}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending ? "Envoi…" : "Recevoir un lien de connexion"}
        </Button>
      </form>
    </>
  );
}
