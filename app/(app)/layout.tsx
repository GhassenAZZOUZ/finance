import { FinanceGate, FinanceProvider } from "@/components/app/finance-provider";
import { MobileHeader, MobileNav, Sidebar } from "@/components/app/nav";

/**
 * Signed-in shell: fixed sidebar on desktop, top bar + bottom tab bar on mobile.
 * FinanceProvider guards access and feeds the shell (pending check-ins); FinanceGate holds the page
 * until the data is loaded.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <FinanceProvider>
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Aller au contenu
      </a>
      <div className="flex min-h-full flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileHeader />
          <main
            id="contenu"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-4 px-4 pt-5 pb-28 outline-none md:gap-6 md:px-8 md:pt-10 md:pb-14 xl:px-12"
          >
            <FinanceGate>{children}</FinanceGate>
          </main>
        </div>
      </div>
      <MobileNav />
    </FinanceProvider>
  );
}
