"use client";

import { useActionState } from "react";
import { type LoginState, sendMagicLink } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
        <p className="font-medium">Lien envoyé à {state.email}.</p>
        <p className="mt-1">Ouvrez l’e-mail et cliquez sur le lien pour vous connecter.</p>
      </div>
    );
  }

  return (
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
  );
}
