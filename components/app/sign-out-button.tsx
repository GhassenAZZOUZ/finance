"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Signs out and goes to the login page (the buttons below, the « Plus » page row). */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  return async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login/");
  };
}

/** `iconOnly`: 44px icon button; otherwise a full-width labelled button (sidebar account menu). */
export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const signOut = useSignOut();
  if (iconOnly) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 text-muted-foreground"
        aria-label="Se déconnecter"
        title="Se déconnecter"
        onClick={signOut}
      >
        <LogOut aria-hidden className="size-4.5" />
      </Button>
    );
  }
  return (
    <Button type="button" variant="outline" className="min-h-11 w-full justify-start" onClick={signOut}>
      <LogOut aria-hidden className="size-4" />
      <span>Déconnexion</span>
    </Button>
  );
}
