import { AppLock } from "@/components/app/app-lock";
import { FinanceGate, FinanceProvider } from "@/components/app/finance-provider";
import { MobileHeader, MobileNav, Sidebar } from "@/components/app/nav";
import { PaywallHost } from "@/components/app/paywall";
import { TourProvider } from "@/components/app/tour";

/**
 * Signed-in shell: fixed sidebar on desktop; on mobile a 5-tab bottom bar (and a small header on the home).
 * FinanceProvider guards access and feeds the shell (pending check-ins); FinanceGate holds the page
 * until the data is loaded. TourProvider opens the guided tour on a user's first visit. In the Android
 * app, AppLock hides it all behind the biometric lock (#84).
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <FinanceProvider>
      <AppLock>
        <TourProvider>
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
                className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-4 px-4 pt-5 pb-28 outline-none md:gap-6 md:px-8 md:pt-10 md:pb-14 xl:px-12 print:p-0"
              >
                <FinanceGate>{children}</FinanceGate>
              </main>
            </div>
          </div>
          <MobileNav />
          <PaywallHost />
        </TourProvider>
      </AppLock>
    </FinanceProvider>
  );
}
