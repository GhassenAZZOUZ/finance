import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion · Plan financier" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plan financier</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Budget, crédits, épargne et suivi mensuel. Connectez-vous avec un lien reçu par e-mail, sans mot de passe.
        </p>
      </div>
      {/* useSearchParams (the ?error flag) needs a Suspense boundary in a static export. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
