import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmLogin } from "./confirm-login";

export const metadata: Metadata = { title: "Connexion · Cap" };

export default function ConfirmPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Suspense>
        <ConfirmLogin />
      </Suspense>
    </main>
  );
}
