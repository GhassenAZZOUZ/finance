import { LogOut } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { DesktopNav, MobileNav } from "@/components/app/nav";
import { Button } from "@/components/ui/button";

/** Signed-in shell: header + desktop links, bottom tab bar on mobile. proxy.ts guards access. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Aller au contenu
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <span className="font-semibold">Plan financier</span>
          <DesktopNav />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="min-h-10">
              <LogOut aria-hidden className="size-4" />
              <span>Déconnexion</span>
            </Button>
          </form>
        </div>
      </header>
      <main id="contenu" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-24 pt-6 md:pb-10">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}
