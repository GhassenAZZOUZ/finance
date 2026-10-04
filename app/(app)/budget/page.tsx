import type { Metadata } from "next";
import { BudgetView } from "./view";

export const metadata: Metadata = { title: "Budget · Boussole" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return <BudgetView />;
}
