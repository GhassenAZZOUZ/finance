"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-10"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.replace("/login/");
      }}
    >
      <LogOut aria-hidden className="size-4" />
      <span>Déconnexion</span>
    </Button>
  );
}
