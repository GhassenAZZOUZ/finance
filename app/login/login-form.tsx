"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authConfirmUrl, supabaseBrowser } from "@/lib/supabase/client";

interface LoginState {
  status: "idle" | "sent" | "error";
  message?: string;
  email?: string;
}

interface CodeState {
  status: "idle" | "error";
  message?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase one-time codes: `otp_length = 6`, locally and on the hosted project (#3). */
const CODE_LENGTH = 6;
const CODE = new RegExp(`^\\d{${CODE_LENGTH}}$`);

/** Sends the login email: a magic link (same browser, PKCE) and a one-time code (any device). */
async function sendLoginEmail(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!EMAIL.test(email)) return { status: "error", message: "Adresse e-mail invalide", email };
  const { error } = await supabaseBrowser().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authConfirmUrl() },
  });
  if (error) return { status: "error", message: "Envoi impossible pour le moment. Réessayez dans un instant.", email };
  return { status: "sent", email };
}

/** Query flag set after « Supprimer mon compte » (SPEC D26). */
export const DELETED_FLAG = "compte-supprime";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const linkError = params.get("error") !== null;
  const accountDeleted = params.has(DELETED_FLAG);
  const [state, action, pending] = useActionState<LoginState, FormData>(sendLoginEmail, { status: "idle" });
  // Lets the user go back to the address form (e.g. typo in the address).
  const [editingAddress, setEditingAddress] = useState(false);

  // Already signed in: go straight to the app.
  useEffect(() => {
    void supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace("/");
      });
  }, [router]);

  if (state.status === "sent" && state.email && !editingAddress) {
    return (
      <CodeStep
        email={state.email}
        onSignedIn={() => router.replace("/")}
        onChangeAddress={() => setEditingAddress(true)}
      />
    );
  }

  return (
    <>
      {accountDeleted ? (
        <p role="status" className="rounded-md border border-good-border bg-good-bg px-3 py-2 text-sm text-good">
          Votre compte et toutes vos données ont été supprimés.
        </p>
      ) : null}
      {linkError ? (
        <p role="alert" className="rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          Ce lien de connexion est invalide, a expiré, ou a été ouvert dans un autre navigateur que celui où vous
          l’avez demandé. Demandez-en un nouveau, ou utilisez le code reçu par e-mail.
        </p>
      ) : null}
      <form
        action={(formData) => {
          setEditingAddress(false);
          action(formData);
        }}
        className="flex flex-col gap-3"
        noValidate
      >
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
            <p id="email-error" className="text-sm text-bad">
              {state.message}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending ? "Envoi…" : "Recevoir un code de connexion"}
        </Button>
      </form>
    </>
  );
}

/** Second step: type the code from the email (works on any device), or click the link. */
function CodeStep({
  email,
  onSignedIn,
  onChangeAddress,
}: {
  email: string;
  onSignedIn: () => void;
  onChangeAddress: () => void;
}) {
  // Digits only, at most 6 (#119): a pasted « 123 456 » or « 123-456 » becomes « 123456 ».
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const [state, verify, pending] = useActionState<CodeState, FormData>(async (_prev, formData) => {
    const token = String(formData.get("code") ?? "").replace(/\D/g, "");
    if (!CODE.test(token)) return { status: "error", message: `Saisissez les ${CODE_LENGTH} chiffres du code reçu par e-mail.` };
    const { error } = await supabaseBrowser().auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      // Cleared and focused again (#120, #3 AC-04), ready for another try.
      setCode("");
      return { status: "error", message: "Code invalide ou expiré. Vérifiez-le, ou demandez un nouveau code." };
    }
    onSignedIn();
    return { status: "idle" };
  }, { status: "idle" });
  useEffect(() => {
    if (state.status === "error") codeRef.current?.focus();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="rounded-md border border-good-border bg-good-bg px-4 py-3 text-sm text-good">
        <p className="font-medium">E-mail envoyé à {email}.</p>
        <p className="mt-1">
          Saisissez le code qu’il contient ci-dessous, ou cliquez sur son lien dans ce même navigateur.
        </p>
      </div>
      <form action={verify} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Code de connexion</Label>
          <Input
            ref={codeRef}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
            required
            autoFocus
            className="font-mono text-lg tracking-[0.3em]"
            aria-invalid={state.status === "error" || undefined}
            aria-describedby={state.status === "error" ? "code-error" : undefined}
          />
          {state.status === "error" ? (
            <p id="code-error" role="alert" className="text-sm text-bad">
              {state.message}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={pending || !CODE.test(code)} className="min-h-11">
          {pending ? "Vérification…" : "Se connecter"}
        </Button>
      </form>
      <Button type="button" variant="ghost" className="min-h-10 self-start" onClick={onChangeAddress}>
        Utiliser une autre adresse ou renvoyer un code
      </Button>
    </div>
  );
}
