"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type State = "working" | "done" | "invalid" | "error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unsubscribe link of the monthly reminder (issue #6): turns it off for the owner of the token,
 * without logging in. It can be turned back on from « Mes données ».
 */
export function Unsubscribe() {
  const token = useSearchParams().get("jeton") ?? "";
  const [state, setState] = useState<State>(UUID.test(token) ? "working" : "invalid");
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !UUID.test(token)) return;
    started.current = true;
    void supabaseBrowser()
      .rpc("unsubscribe_reminder", { p_token: token })
      .then(({ data, error }) => setState(error ? "error" : data === true ? "done" : "invalid"));
  }, [token]);

  if (state === "working") return <p role="status">Désinscription en cours…</p>;
  if (state === "done") {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md border border-good-border bg-good-bg px-4 py-3 text-sm text-good">
        <p className="font-medium">Vous ne recevrez plus le rappel mensuel.</p>
        <p>
          Vous pouvez le réactiver à tout moment dans{" "}
          <Link href="/donnees" className="underline underline-offset-2">
            Mes données
          </Link>
          .
        </p>
      </div>
    );
  }
  return (
    <p role="alert" className="rounded-md border border-bad-border bg-bad-bg px-4 py-3 text-sm text-bad">
      {state === "invalid"
        ? "Ce lien de désinscription n’est pas valide. Vous pouvez désactiver le rappel dans « Mes données » après connexion."
        : "La désinscription a échoué. Réessayez dans un instant."}
    </p>
  );
}
