import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion · Plan financier" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plan financier</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Budget, crédits, épargne et suivi mensuel. Connectez-vous avec un lien reçu par e-mail, sans mot de passe.
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Ce lien de connexion est invalide ou a expiré. Demandez-en un nouveau.
        </p>
      ) : null}
      <LoginForm />
    </main>
  );
}
