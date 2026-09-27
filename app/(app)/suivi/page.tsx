import type { Metadata } from "next";
import { SuiviView } from "./view";

export const metadata: Metadata = { title: "Suivi mensuel · Plan financier" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return <SuiviView />;
}
