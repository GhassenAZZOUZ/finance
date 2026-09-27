import type { Metadata } from "next";
import { DashboardView } from "./view";

export const metadata: Metadata = { title: "Tableau de bord · Plan financier" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return <DashboardView />;
}
