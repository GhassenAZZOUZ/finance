import type { Metadata } from "next";
import { CreditsView } from "./view";

export const metadata: Metadata = { title: "Crédits · Cap" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return <CreditsView />;
}
