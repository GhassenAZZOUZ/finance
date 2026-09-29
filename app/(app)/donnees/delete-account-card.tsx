"use client";

import { Download, TriangleAlert, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useFinance } from "@/components/app/finance-provider";
import { tourStorageKey } from "@/components/app/tour-logic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRepository } from "@/lib/data/client-store";
import { errorMessage, reportError } from "@/lib/errors";
import { backupFileName, buildBackup, serializeBackup } from "@/lib/export/backup";
import { downloadFile } from "@/lib/export/download";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DELETED_FLAG } from "@/app/login/login-form";

export const CONFIRM_WORD = "SUPPRIMER";

/**
 * « Supprimer mon compte » (issue #37, SPEC D26): typing SUPPRIMER confirms; the account and every
 * row of the user are deleted at once by `delete_my_account()`. The JSON backup is offered first.
 */
export function DeleteAccountCard() {
  const router = useRouter();
  const { email } = useFinance();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadBackup() {
    setError(null);
    try {
      const now = new Date();
      downloadFile(backupFileName(now), serializeBackup(buildBackup(await getRepository().load(), now)), "application/json");
    } catch (loadError) {
      reportError(loadError, "account.backup");
      setError(errorMessage(loadError, "La sauvegarde n’a pas pu être préparée. Réessayez dans un instant."));
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await getRepository().deleteAccount();
    } catch (deleteError) {
      reportError(deleteError, "account.delete");
      setError(errorMessage(deleteError, "Votre compte n’a pas été supprimé. Réessayez dans un instant."));
      setBusy(false);
      return;
    }
    // The user no longer exists: only the local session is dropped. The theme choice is kept.
    try {
      localStorage.removeItem(tourStorageKey(email));
    } catch {
      // Storage blocked: nothing to clear.
    }
    await supabaseBrowser().auth.signOut({ scope: "local" });
    router.replace(`/login/?${DELETED_FLAG}`);
  }

  return (
    <Card className="w-full max-w-2xl border-bad-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserX aria-hidden className="size-5 shrink-0" />
          <h2>Supprimer mon compte</h2>
        </CardTitle>
        <CardDescription>
          Supprime immédiatement et définitivement votre compte et toutes vos données : budget, crédits, objectifs, saisies de suivi et
          préférences de rappel.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!open ? (
          <div>
            <Button type="button" variant="outline" className="min-h-11 text-bad md:min-h-9" onClick={() => setOpen(true)}>
              Supprimer mon compte…
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed === CONFIRM_WORD && !busy) void confirm();
            }}
          >
            <p className="rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-bad">
              Cette action est irréversible : vos données ne pourront pas être récupérées. Les sauvegardes techniques de l’hébergeur sont
              effacées au terme de leur durée de conservation.
            </p>
            <div>
              <Button type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => void downloadBackup()}>
                <Download aria-hidden className="size-4" />
                Télécharger d’abord ma sauvegarde (JSON)
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>Pour confirmer, tapez {CONFIRM_WORD}</Label>
              <Input
                id={inputId}
                value={typed}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" className="min-h-11 md:min-h-9" disabled={typed !== CONFIRM_WORD || busy}>
                {busy ? "Suppression…" : "Supprimer définitivement"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 md:min-h-9"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </form>
        )}
        {error ? (
          <p role="alert" className="flex items-center gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-bad">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
