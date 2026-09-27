import type { Metadata } from "next";
import { BudgetView } from "./view";

export const metadata: Metadata = { title: "Budget · Plan financier" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return <BudgetView />;
}
