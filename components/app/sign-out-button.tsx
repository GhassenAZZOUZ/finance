"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";

/** `iconOnly`: 44px icon button (sidebar); otherwise a full-width labelled button (mobile menu). */
export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const router = useRouter();
  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login/");
  };
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
